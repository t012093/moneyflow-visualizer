import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError, PoliteClient, RobotsDisallowed, type HttpState } from '../src/http.ts';
import { isAllowed, parseRobots } from '../src/robots.ts';

/** 時計と待ち時間を手で進める、テスト用の通信相手。 */
function harness(handler: (url: string, init: RequestInit) => Response | Promise<Response>, state: HttpState = {}) {
  let clock = 1_000_000;
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const client = new PoliteClient({
    userAgent: 'yukue-collector/0.1 (test)',
    minIntervalMs: 1500,
    timeoutMs: 5000,
    state,
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, at: clock, headers: (init?.headers ?? {}) as Record<string, string> });
      return handler(url, init ?? {});
    }) as typeof fetch
  });
  return { client, calls, sleeps, state };
}

const robotsOk = (url: string) => (url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /private/\n') : null);

test('robots.txt：自分の名前のグループを優先し、長く一致した規則に従う', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: yukue-collector\nDisallow: /search\nAllow: /search/public\nCrawl-delay: 5\n';
  const mine = parseRobots(txt, 'yukue-collector');
  assert.equal(mine.crawlDelay, 5);
  assert.equal(isAllowed(mine, '/news.rss'), true);
  assert.equal(isAllowed(mine, '/search?q=a'), false);
  assert.equal(isAllowed(mine, '/search/public/1'), true);
  const others = parseRobots(txt, 'somebot');
  assert.equal(isAllowed(others, '/news.rss'), false);
});

test('robots.txt：* と行末の $ を解釈する', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/x\n', 'yukue-collector');
  assert.equal(isAllowed(r, '/a/b.pdf'), false);
  assert.equal(isAllowed(r, '/a/b.pdf?x=1'), true);
  assert.equal(isAllowed(r, '/tmp123/x'), false);
});

test('同じホストには間隔をあけて取りに行く', async () => {
  const h = harness(url => robotsOk(url) ?? new Response('ok'));
  await h.client.get('https://a.example/1');
  await h.client.get('https://a.example/2');
  await h.client.get('https://b.example/1');
  const a = h.calls.filter(c => c.url.startsWith('https://a.example'));
  assert.equal(a.length, 3, 'robots.txt と2ページ');
  assert.ok(a[1].at - a[0].at >= 1500 && a[2].at - a[1].at >= 1500);
  assert.equal(h.calls.find(c => c.url === 'https://b.example/1')!.headers['user-agent'], 'yukue-collector/0.1 (test)');
});

test('robots.txt の Crawl-delay が長ければ、そちらに合わせる', async () => {
  const h = harness(url => (url.endsWith('/robots.txt') ? new Response('User-agent: *\nCrawl-delay: 4\n') : new Response('ok')));
  await h.client.get('https://a.example/1');
  await h.client.get('https://a.example/2');
  const pages = h.calls.filter(c => !c.url.endsWith('/robots.txt'));
  assert.ok(pages[1].at - pages[0].at >= 4000);
});

test('Disallow のページは取りに行かない', async () => {
  const h = harness(url => robotsOk(url) ?? new Response('ok'));
  await assert.rejects(h.client.get('https://a.example/private/x'), RobotsDisallowed);
  assert.equal(h.calls.filter(c => c.url.includes('/private/')).length, 0);
});

test('robots.txt が 5xx のときは、取得を見送る。404 なら制限なしとして進む', async () => {
  const down = harness(url => (url.endsWith('/robots.txt') ? new Response('', { status: 503 }) : new Response('ok')));
  await assert.rejects(down.client.get('https://a.example/1'), RobotsDisallowed);
  const none = harness(url => (url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('ok')));
  assert.equal((await none.client.get('https://a.example/1')).text, 'ok');
});

test('2回目は条件付きで取りに行き、304 なら本文を受け取らない', async () => {
  let n = 0;
  const h = harness((url, init) => {
    const fromRobots = robotsOk(url);
    if (fromRobots) return fromRobots;
    n++;
    const hdr = init.headers as Record<string, string>;
    if (hdr['if-none-match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response('<rss/>', { headers: { etag: '"v1"', 'last-modified': 'Tue, 24 Nov 2026 08:00:00 GMT' } });
  });
  const first = await h.client.get('https://a.example/news.rss');
  assert.deepEqual([first.status, first.changed, first.notModified], [200, true, false]);
  assert.equal(h.state['https://a.example/news.rss'].etag, '"v1"');
  const second = await h.client.get('https://a.example/news.rss');
  assert.deepEqual([second.status, second.changed, second.notModified], [304, false, true]);
  assert.equal(n, 2);
});

test('ETag がなくても、中身が同じなら「変更なし」と分かる', async () => {
  const h = harness(url => robotsOk(url) ?? new Response('same body'));
  assert.equal((await h.client.get('https://a.example/x')).changed, true);
  assert.equal((await h.client.get('https://a.example/x')).changed, false);
});

test('一時的な失敗（503・通信エラー）は待ってからやり直し、404 はやり直さない', async () => {
  let tries = 0;
  const flaky = harness(url => {
    const fromRobots = robotsOk(url);
    if (fromRobots) return fromRobots;
    tries++;
    if (tries === 1) return new Response('', { status: 503, headers: { 'retry-after': '2' } });
    if (tries === 2) throw new Error('socket hang up');
    return new Response('ok');
  });
  assert.equal((await flaky.client.get('https://a.example/x')).text, 'ok');
  assert.equal(tries, 3);
  assert.ok(flaky.sleeps.includes(2000), 'Retry-After に従う');

  let hits = 0;
  const missing = harness(url => robotsOk(url) ?? (hits++, new Response('', { status: 404 })));
  await assert.rejects(missing.client.get('https://a.example/none'), (e: unknown) => e instanceof HttpError && e.status === 404);
  assert.equal(hits, 1);
});

test('やり直しても 5xx なら、その情報源だけ失敗として返す', async () => {
  const h = harness(url => robotsOk(url) ?? new Response('', { status: 500 }));
  await assert.rejects(h.client.get('https://a.example/x'), (e: unknown) => e instanceof HttpError && e.status === 500);
  assert.equal(h.calls.filter(c => c.url.endsWith('/x')).length, 3);
});

test('binary を指定すると、中身をそのまま返し、大きさの上限も変えられる', async () => {
  const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/zip', 'last-modified': 'Wed, 25 Nov 2026 05:27:13 GMT' } });
  }) as typeof fetch;
  const client = new PoliteClient({ userAgent: 'test/1.0', minIntervalMs: 0, timeoutMs: 1000, state: {}, fetchImpl, sleep: async () => {} });
  const page = await client.get('https://example.go.jp/a.zip', { binary: true });
  assert.deepEqual([...(page.bytes ?? [])], [...body]);
  assert.equal(page.text, '');
  assert.equal(page.lastModified, 'Wed, 25 Nov 2026 05:27:13 GMT');
  await assert.rejects(() => client.get('https://example.go.jp/b.zip', { binary: true, maxBytes: 4, conditional: false }), /大きすぎる/);
});
