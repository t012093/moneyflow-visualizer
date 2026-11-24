/**
 * ビルドした画面を、実際のブラウザーで確かめる（Playwright）。
 *
 * 使い方：
 *   npm run build && npx vite preview --port 4173 --strictPort &
 *   npm run browser-check
 *
 * Playwright はこのパッケージの依存には入れていない。別に用意する
 * （npm install --no-save playwright && npx playwright install chromium。ほかの場所にあるなら NODE_PATH で指す）。
 * 環境変数： YUKUE_URL（既定 http://127.0.0.1:4173/）、YUKUE_SHOTS（スクリーンショットの保存先。無ければ撮らない）
 *
 * 見るところ：1440px と 390px、ライトとダークで、
 *   ・コンソールのエラーがない（外へのリクエストはすべて止める。止めたことで出るエラーは別に数える）
 *   ・どの画面でも、ページが横にはみ出さない
 *   ・流れ図の内訳に進める／単位と表の切り替え／強調
 *   ・「例でためす」で、あなたに合う制度の一覧が変わる
 *   ・申請の準備の4つの段階が進む
 *   ・チャットが質問の例に答え、画面を動かす
 *   ・政策の動き（キーワード、すべての発表、もっと見る、締切、正式な名前、リンク）と、Jグランツの一覧
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.YUKUE_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.YUKUE_SHOTS || '';
const VIEWS = ['home', 'flow', 'updates', 'find', 'me', 'apply', 'connect', 'about'];
const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 }
];
const SCHEMES = ['light', 'dark'];

const failures = [];
let checks = 0;
function check(where, label, ok, detail) {
  checks++;
  if (!ok) {
    failures.push(`[${where}] ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
    console.log(`  NG  ${label}`, detail !== undefined ? detail : '');
  }
}

/** 画面と同じ決まり：その分野の、直近14日で重要度の高い動き（同じなら新しい順）。足りなければ前のものを足す */
function pickByTheme(items, theme, count, today, days = 14) {
  const pool = items.filter(u => !u.noise && u.theme === theme);
  const byWeight = (a, b) => b.importance - a.importance || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const age = u => Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(u.date + 'T00:00:00Z')) / 86400000);
  const recent = pool.filter(u => age(u) <= days).sort(byWeight);
  if (recent.length >= count) return recent.slice(0, count);
  return [...recent, ...pool.filter(u => age(u) > days).sort(byWeight)].slice(0, count);
}

const jst = iso => {
  const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  const ymd = d.toISOString().slice(0, 10);
  return { ymd, date: ymd.replace(/-/g, '.'), dow: '日月火水木金土'[d.getUTCDay()], time: d.toISOString().slice(11, 16) };
};
const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function getJson(file) {
  const res = await fetch(BASE + 'data/' + file);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

async function run() {
  const data = {
    budget: await getJson('budget/fy2026.json'),
    updates: await getJson('updates/latest.json'),
    programs: await getJson('programs/curated.json'),
    briefing: await getJson('briefing.json').catch(() => null),
    jgrants: await getJson('programs/jgrants.json').catch(() => ({ items: [] })),
    run: await getJson('runs/latest.json').catch(() => null)
  };
  const today = todayJst();
  const visible = data.updates.items.filter(u => !u.noise);
  const noise = data.updates.items.length - visible.length;
  console.log(
    `data: updates ${data.updates.items.length}（noise ${noise}）, jgrants ${data.jgrants.items.length}, sources ${data.run ? data.run.sources.length : '-'}, today(JST) ${today}`
  );

  const browser = await chromium.launch();
  const summary = [];

  for (const size of SIZES) {
    for (const scheme of SCHEMES) {
      const where = `${size.name}/${scheme}`;
      console.log(`\n== ${where} ==`);
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: scheme,
        deviceScaleFactor: 1,
        locale: 'ja-JP',
        permissions: ['clipboard-read', 'clipboard-write']
      });
      const blocked = new Set();
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(BASE)) return route.continue();
        blocked.add(url);
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      const blockedErrors = [];
      page.on('console', m => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        const url = m.location().url || '';
        if (m.type() === 'error' && blocked.has(url)) blockedErrors.push(url);
        else errors.push(`${m.type()}: ${m.text()} ${url}`);
      });
      page.on('pageerror', e => errors.push('pageerror: ' + String(e)));

      const shot = async name => {
        if (!SHOTS) return;
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}-${size.name}-${scheme}.png`), fullPage: true });
      };
      const go = async view => {
        await page.evaluate(v => {
          window.location.hash = v;
        }, view);
        await page.waitForSelector(`section.view[data-view="${view}"]`);
        await page.waitForTimeout(120);
      };
      /** ページ全体が横にはみ出していないか */
      const noOverflow = async label => {
        const m = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          win: window.innerWidth
        }));
        check(where, `横にはみ出さない：${label}`, m.doc <= m.win && m.body <= m.win, m);
      };
      const text = sel => page.locator(sel).first().innerText();
      const count = sel => page.locator(sel).count();
      const isOverlay = size.width < 1180;
      const openDock = async () => {
        if (await page.locator('#shell.dock-open').count()) return;
        if (size.width < 760) await page.click('.tabbar button');
        else await page.click('.hdr .btn-ai');
        await page.waitForSelector('#shell.dock-open');
      };
      const closeDock = async () => {
        if (!(await page.locator('#shell.dock-open').count())) return;
        await page.click('.dock .icon-btn');
        await page.waitForSelector('#shell:not(.dock-open)');
      };

      /* ---------- 読み込みと、すべての画面 ---------- */
      await page.goto(BASE + '#home');
      await page.waitForSelector('section.view[data-view="home"]');
      check(where, 'データはビルドに埋め込まず、あとから読み込む', (await page.content()).includes('<div id="root">'), undefined);
      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { plane: cs.getPropertyValue('--plane').trim(), bg: getComputedStyle(document.body).backgroundColor };
      });
      check(where, '配色のトークン', tokens.plane === (scheme === 'dark' ? '#0c1018' : '#f2f4f8'), tokens);
      check(where, '背景色', tokens.bg === (scheme === 'dark' ? 'rgb(12, 16, 24)' : 'rgb(242, 244, 248)'), tokens);

      if (isOverlay) await closeDock();
      for (const v of VIEWS) {
        await go(v);
        await noOverflow(v);
        const cur = await page.evaluate(() => [...document.querySelectorAll('.view')].map(s => s.getAttribute('data-view')));
        check(where, `画面は1つだけ出す：${v}`, cur.length === 1 && cur[0] === v, cur);
        await shot(v);
      }
      // 「AIに聞く」を開いた状態でも、はみ出さない
      await openDock();
      for (const v of ['home', 'flow', 'find']) {
        if (isOverlay) await closeDock();
        await go(v);
        await openDock();
        await noOverflow(`${v}（AIに聞くを開く）`);
      }
      if (isOverlay) {
        const lock = await page.evaluate(() => document.body.style.overflow);
        check(where, 'かぶせて開いているあいだは、うしろをスクロールさせない', lock === 'hidden', lock);
        check(where, 'うしろを覆う幕が出る', await page.locator('.scrim').isVisible(), undefined);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#shell:not(.dock-open)');
        check(where, 'Esc で閉じる', (await page.evaluate(() => document.body.style.overflow)) === '', undefined);
      }

      /* ---------- ホーム ---------- */
      await go('home');
      const stamp = jst(data.updates.generatedAt);
      const eyebrow = await text('.brief .eyebrow');
      check(where, '更新の日時は日本時間', eyebrow === `${stamp.date} ${stamp.dow} ・ ${stamp.time} 更新`, { eyebrow, stamp });
      const ids = new Set(data.updates.items.map(u => u.id));
      const briefExpected = data.briefing ? [...new Set(data.briefing.items.map(i => i.id).filter(id => ids.has(id)))].slice(0, 5).length : 0;
      const briefShown = await count('.brief-item');
      check(where, 'きょうの動きは briefing.json から', briefExpected ? briefShown === briefExpected : briefShown <= 3, { briefShown, briefExpected });
      const aiTag = await count('.brief-foot .tag');
      check(where, '「AI要約」の印は、AIがまとめたときだけ', aiTag === (data.briefing && data.briefing.method === 'ai' && briefShown ? 1 : 0), aiTag);
      const followTitles = await page.locator('.home-low section').nth(0).locator('.row .row-t').allInnerTexts();
      const followWant = ['social', 'industry', 'local'].flatMap(t => pickByTheme(data.updates.items, t, 1, today)).map(u => u.title.trim());
      check(where, 'フォロー中のテーマ：直近14日で重要度の高い動きを出す', JSON.stringify(followTitles.map(t => t.trim())) === JSON.stringify(followWant), { followTitles, followWant });
      const agenda = await page.locator('.home-low section').nth(1).locator('.row').count();
      check(where, 'これからの予定は6件まで', agenda >= 1 && agenda <= 6, agenda);
      const whens = await page.locator('.home-low section').nth(1).locator('.row .row-d').allInnerTexts();
      check(where, 'これからの予定に日付がある', whens.every(w => w.trim().length > 0), whens);
      check(where, 'ホームの図', (await count('#v-home svg.fl g.nd')) === data.budget.src.length + 1 + data.budget.use.length, undefined);
      check(where, 'ページ上の注意書き', (await text('.sample-note')).includes('試作版') && (await page.locator('.sample-note a').getAttribute('href')) === '#about', undefined);

      /* ---------- お金の流れ ---------- */
      await go('flow');
      const rootNodes = data.budget.src.length + 1 + data.budget.use.length;
      check(where, '全体の図：項目の数', (await count('#v-flow svg.fl g.nd')) === rootNodes, await count('#v-flow svg.fl g.nd'));
      check(where, '全体の図：帯の数', (await count('#v-flow svg.fl path.rib')) === data.budget.src.length + data.budget.use.length, undefined);
      const fills = await page.evaluate(() =>
        [...document.querySelectorAll('#v-flow svg.fl path.rib')].map(p => getComputedStyle(p).fill).filter(f => !f || f === 'rgb(0, 0, 0)' || f === 'none')
      );
      check(where, '帯の色は CSS の変数から決まる（黒や無色にならない）', fills.length === 0, fills);
      const first = data.budget.use[0];
      check(where, '最初は、いちばん上の使いみちをえらんでいる', (await text('.sel-bar b')) === first.name, await text('.sel-bar b'));
      check(where, 'えらんだ項目と帯の印', (await count('#v-flow g.nd.sel')) === 1 && (await count('#v-flow path.rib.sel')) === 1, undefined);
      const relTitles = (await page.locator('.detail .d-sub:has-text("関連する動き") ~ button .d-link-t').allInnerTexts()).map(t => t.trim());
      const relWant = pickByTheme(data.updates.items, first.theme, 2, today).map(u => u.title.trim());
      check(where, '関連する動き：直近14日で重要度の高い動きを出す', JSON.stringify(relTitles) === JSON.stringify(relWant), { relTitles, relWant });

      // 内訳に進む（ボタン）
      await page.click('.sel-bar .btn');
      await page.waitForSelector('.crumb button');
      const drill = first.drill.items;
      const recips = new Set(drill.flatMap(i => Object.keys(i.to)));
      check(where, '内訳の図：項目の数', (await count('#v-flow svg.fl g.nd')) === 1 + drill.length + recips.size, await count('#v-flow svg.fl g.nd'));
      check(where, '内訳の図：階層の表示', (await text('.crumb .cur')) === first.name, await text('.crumb .cur'));
      const scroll = await page.evaluate(() => {
        const el = document.querySelector('#v-flow .flow-scroll');
        return { sw: el.scrollWidth, cw: el.clientWidth };
      });
      if (size.width < 760) {
        check(where, '狭い画面の内訳は、図だけが横にスクロールする', scroll.sw > scroll.cw + 8, scroll);
        check(where, '「横にスクロールできます」を出す', (await count('.crumb-hint')) === 1, undefined);
      } else {
        check(where, '広い画面の内訳は、スクロールなしで入る', scroll.sw <= scroll.cw + 1 && (await count('.crumb-hint')) === 0, scroll);
      }
      await noOverflow('flow（内訳）');
      await shot('flowdrill');
      // 内訳の項目をえらぶ → 説明が変わる
      await page.locator('#v-flow g.nd').nth(1).click();
      check(where, '内訳の項目をえらぶと、説明が変わる', (await text('.detail .d-h1')) === drill[0].name, await text('.detail .d-h1'));
      // 届け先をえらぶ → どの内訳から届くか
      await page.locator('#v-flow g.nd').last().click();
      check(where, '届け先をえらぶと「どの内訳から届くか」を出す', (await page.locator('.detail').innerText()).includes('どの内訳から届くか'), undefined);
      // 全体に戻る
      await page.click('.crumb button');
      check(where, '全体に戻る', (await count('.crumb button')) === 0 && (await text('.sel-bar b')) === first.name, await text('.sel-bar b'));

      // 図の項目を2回押して内訳に進む（内訳のある2つめの使いみち）
      const second = data.budget.use.filter(u => u.drill && u.drill.items.length)[1];
      const node = page.locator(`#v-flow g.nd[aria-label^="${second.name} "]`);
      await node.click();
      check(where, '図の項目を押すとえらべる', (await text('.sel-bar b')) === second.name, await text('.sel-bar b'));
      check(where, '説明の見出し', (await text('.detail .d-h1')) === (second.long || second.name), await text('.detail .d-h1'));
      check(where, '推移の図', (await count('.detail svg.trend')) === (second.trend ? 1 : 0), undefined);
      await node.click();
      await page.waitForSelector('.crumb button');
      check(where, 'もう一度押すと内訳に進む', (await text('.crumb .cur')) === second.name, await text('.crumb .cur'));
      await page.click('.crumb button');

      // 強調：ポインターとフォーカス
      await page.locator('#v-flow g.nd').first().hover();
      check(where, 'ポインターを合わせると強調する', (await count('#v-flow svg.fl.has-hi')) === 1 && (await count('#v-flow path.rib.hi')) === 1, undefined);
      check(where, '吹き出しを出す', await page.locator('.tip').isVisible(), undefined);
      await page.mouse.move(2, 2);
      check(where, 'ポインターを外すと戻る', (await count('#v-flow svg.fl.has-hi')) === 0 && !(await page.locator('.tip').isVisible()), undefined);
      await page.locator('#v-flow g.nd').nth(2).focus();
      check(where, 'フォーカスでも強調する', (await count('#v-flow svg.fl.has-hi')) === 1 && (await count('#v-flow g.nd.hi')) === 2, await count('#v-flow g.nd.hi'));
      await page.keyboard.press('Enter');
      check(where, 'Enter でえらべる', (await text('.sel-bar b')) === data.budget.src[2].name, await text('.sel-bar b'));
      await page.evaluate(() => document.activeElement && document.activeElement.blur());

      // 単位と表
      const labelOf = () => page.locator('#v-flow g.nd text.lab .lv').first().innerHTML();
      const choLabel = await labelOf();
      await page.click('#v-flow .seg button:has-text("1人あたり")');
      const pcLabel = await labelOf();
      check(where, '単位：1人あたり', /^約[\d.,]+万円$/.test(pcLabel) || /^約[\d.,]+万$/.test(pcLabel), pcLabel);
      check(where, '単位の説明が図の下に出る', (await text('.flow-card .cap')).includes('1人あたり＝'), undefined);
      await noOverflow('flow（1人あたり）');
      await page.click('#v-flow .seg button:has-text("1万円のうち")');
      check(where, '単位：1万円のうち', /^[\d.,]+円$/.test(await labelOf()), await labelOf());
      await noOverflow('flow（1万円のうち）');
      await page.click('#v-flow .seg button:has-text("兆円")');
      check(where, '単位：兆円に戻る', (await labelOf()) === choLabel, await labelOf());
      await page.click('#v-flow .seg button:has-text("表")');
      check(where, '表：行の数', (await count('#v-flow table.tbl tbody tr')) === rootNodes + 3, await count('#v-flow table.tbl tbody tr'));
      await noOverflow('flow（表）');
      await page.click('#v-flow .seg button:has-text("流れ")');
      check(where, '流れに戻る', (await count('#v-flow svg.fl')) === 1, undefined);

      /* ---------- 政策の動き ---------- */
      await go('updates');
      check(where, '見出しの上の言葉（集めていない官報は書かない）', (await text('#v-updates .eyebrow')) === '毎日更新 ・ 各府省・国会・Jグランツから', await text('#v-updates .eyebrow'));
      const shownAtFirst = await count('.up');
      check(where, '最初に出すのは60件まで', shownAtFirst === Math.min(60, visible.length), { shownAtFirst, visible: visible.length });
      check(where, '「もっと見る」', (await count('.feed-more button')) === (visible.length > 60 ? 1 : 0), undefined);
      // 同じ日のなかは、重要度の高い順
      const byId = new Map(data.updates.items.map(u => [u.id, u]));
      const order = await page.evaluate(() => [...document.querySelectorAll('.up')].map(a => a.id.slice(3)));
      let sorted = true;
      for (let i = 1; i < order.length; i++) {
        const a = byId.get(order[i - 1]);
        const b = byId.get(order[i]);
        if (!a || !b || a.date < b.date || (a.date === b.date && a.importance < b.importance)) sorted = false;
      }
      check(where, '新しい日付が先、同じ日は重要度の高い順', sorted, order.slice(0, 5));
      check(where, 'ふだんは人事・入札・会見などを出さない', order.every(id => !byId.get(id).noise), undefined);
      const dayHeads = await page.locator('.day-h').allInnerTexts();
      const hasToday = visible.some(u => u.date === today);
      check(where, 'きょうの日付に「きょう」を付ける', dayHeads.some(h => h.startsWith('きょう')) === hasToday, dayHeads.slice(0, 3));
      if (visible.length > 60) {
        await page.click('.feed-more button');
        check(where, 'もっと見る：60件ずつふえる', (await count('.up')) === Math.min(120, visible.length), await count('.up'));
      }
      // すべての発表
      await page.locator('#upAll').check();
      const allShown = await count('.up');
      check(where, 'すべての発表を表示', allShown === Math.min(60, data.updates.items.length), allShown);
      if (noise > 0) {
        const all = await page.evaluate(() => [...document.querySelectorAll('.up')].map(a => a.id.slice(3)));
        check(where, 'すべての発表：人事などが混ざる（最初の60件のうち）', data.updates.items.length <= 60 ? all.some(id => byId.get(id).noise) : true, undefined);
      }
      await page.locator('#upAll').uncheck();
      // キーワード
      const sample = visible.find(u => u.ministry && u.ministry.length >= 3) || visible[0];
      const kw = sample.ministry || sample.title.slice(0, 4);
      await page.fill('#upQ', kw);
      const norm = s => s.normalize('NFKC').toLowerCase();
      const expected = visible.filter(u => norm(`${u.title}\n${u.summary}\n${u.ministry}`).includes(norm(kw))).length;
      check(where, `キーワード「${kw}」で絞る`, (await count('.up')) === Math.min(60, expected), { got: await count('.up'), expected });
      await page.fill('#upQ', 'このことばはどこにもないはず');
      check(where, '合うものがないときの表示', (await text('.feed')).includes('この条件に合う動きは、いまのところありません。'), undefined);
      await page.fill('#upQ', '');
      // 種類と分野
      for (const [chip, type] of [['法律', 'law'], ['発表', 'news']]) {
        await page.click(`#v-updates .chips[aria-label="種類"] button:has-text("${chip}")`);
        const n = visible.filter(u => u.type === type).length;
        check(where, `種類「${chip}」で絞る`, (await count('.up')) === Math.min(60, n), { got: await count('.up'), n });
      }
      await page.click('#v-updates .chips[aria-label="種類"] button:has-text("すべて")');
      await noOverflow('updates（絞り込みのあと）');

      // 開く：要点（qa）のある項目
      const withQa = visible.find(u => u.qa);
      if (withQa) {
        await page.fill('#upQ', withQa.title);
        await page.locator(`[id="up-${withQa.id}"] .up-h`).click();
        const body = page.locator(`[id="up-${withQa.id}"] .up-body`);
        check(where, '要点のある項目：何が変わる／だれに関係／いつから', (await body.locator('.qa div').count()) === 3, undefined);
        check(where, '要点のある項目：AIに聞く のボタン', (await body.locator('.up-acts .btn').count()) >= 1, undefined);
        const hrefs = await body.locator('a.srcl').evaluateAll(as => as.map(a => a.getAttribute('href')));
        const want = withQa.links.filter(l => l.url.startsWith('https://')).map(l => l.url);
        check(where, '一次情報のリンク', JSON.stringify(hrefs) === JSON.stringify(want), { hrefs, want });
        await page.fill('#upQ', '');
      }
      // 開く：要点のない項目（集めたままの発表）
      const noQa = visible.find(u => !u.qa && u.links.some(l => l.url.startsWith('https://')));
      if (noQa) {
        await page.fill('#upQ', noQa.title);
        await page.locator(`[id="up-${noQa.id}"] .up-h`).click();
        const body = page.locator(`[id="up-${noQa.id}"] .up-body`);
        check(where, '要点のない項目：要点の枠もボタンも出さない', (await body.locator('.qa').count()) === 0 && (await body.locator('.up-acts').count()) === 0, undefined);
        check(where, '要点のない項目：一次情報を出す', (await body.locator('a.srcl').count()) === noQa.links.filter(l => l.url.startsWith('https://')).length, undefined);
        check(where, '要点のない項目：段階は、あるときだけ', (await body.locator('.src:has-text("段階：")').count()) === (noQa.stage ? 1 : 0), undefined);
        check(where, '要約は見出しの下に出ている', !noQa.summary || (await text(`[id="up-${noQa.id}"] .up-sum`)) === noQa.summary.trim(), undefined);
        await page.fill('#upQ', '');
      }
      // #:~:text= の付いたリンクは、そのまま
      const frag = visible.find(u => u.links.some(l => l.url.startsWith('https://') && l.url.includes('#:~:text=')));
      if (frag) {
        await page.fill('#upQ', frag.title);
        await page.locator(`[id="up-${frag.id}"] .up-h`).click();
        const hrefs = await page.locator(`[id="up-${frag.id}"] a.srcl`).evaluateAll(as => as.map(a => a.getAttribute('href')));
        const want = frag.links.filter(l => l.url.startsWith('https://')).map(l => l.url);
        check(where, '#:~:text= の付いたリンクは、書きかえずに出す', JSON.stringify(hrefs) === JSON.stringify(want), { hrefs, want });
        const attrs = await page.locator(`[id="up-${frag.id}"] a.srcl`).first().evaluate(a => [a.target, a.rel]);
        check(where, 'リンクは別のタブで開く', attrs[0] === '_blank' && attrs[1].includes('noopener'), attrs);
        await page.fill('#upQ', '');
      }
      // 正式な名前
      const formal = visible.find(u => u.originalTitle && u.originalTitle !== u.title);
      if (formal) {
        await page.fill('#upQ', formal.title);
        await page.locator(`[id="up-${formal.id}"] .up-h`).click();
        const body = await page.locator(`[id="up-${formal.id}"] .up-body`).innerText();
        check(where, '「正式な名前」を出す', body.includes(`正式な名前：${formal.originalTitle}`), body.slice(0, 120));
        check(where, '見出しは短い題のまま', (await text(`[id="up-${formal.id}"] .up-title`)) === formal.title, undefined);
        await page.fill('#upQ', '');
      }
      // 締切
      const due = visible.find(u => u.deadline && u.deadline >= today);
      if (due) {
        await page.fill('#upQ', due.title);
        const meta = await text(`[id="up-${due.id}"] .up-meta`);
        check(where, '締切を「あとN日」で出す', /締切 (\d+年)?\d+月\d+日（(あと\d+日|きょうまで)）/.test(meta), meta);
        await page.fill('#upQ', '');
      }
      const past = visible.find(u => u.deadline && u.deadline < today);
      if (past) {
        await page.fill('#upQ', past.title);
        const meta = await text(`[id="up-${past.id}"] .up-meta`);
        check(where, '過ぎた締切は出さない', !meta.includes('締切 '), meta);
        await page.fill('#upQ', '');
      }
      // AI要約の印
      const ai = visible.find(u => u.enriched === 'ai');
      const notAi = visible.find(u => u.enriched !== 'ai');
      for (const [u, want] of [[ai, 1], [notAi, 0]]) {
        if (!u) continue;
        await page.fill('#upQ', u.title);
        check(where, `「AI要約」の印（${u.enriched}）`, (await page.locator(`[id="up-${u.id}"] .up-meta .tag`).count()) === want, undefined);
        await page.fill('#upQ', '');
      }
      // ほかの画面から1件を開く（ホームの「きょうの動き」）
      await go('home');
      if (await count('.brief-item')) {
        await page.locator('.brief-item').first().click();
        await page.waitForSelector('section.view[data-view="updates"]');
        await page.waitForTimeout(700);
        const open = await page.evaluate(() => {
          const b = document.querySelector('.up-h[aria-expanded="true"]');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, h: window.innerHeight };
        });
        check(where, 'ホームから1件を開くと、その件を開いて見える位置まで動く', !!open && open.bottom > 0 && open.top < open.h, open);
      }

      /* ---------- 制度をさがす ---------- */
      await go('find');
      const names = () => page.locator('#v-find .prog-name').allInnerTexts();
      const allNames = await names();
      check(where, 'すべての制度', allNames.length === data.programs.length, allNames.length);
      check(where, '設定がないときは「あなたに合う制度」を出さない', (await count('#v-find .seg button:has-text("あなたに合う制度")')) === 0, undefined);
      await page.click('#v-find .chips[aria-label="立場"] button:has-text("NPO・団体")');
      check(where, '立場で絞る', (await names()).length === data.programs.filter(p => p.aud.includes('npo')).length, await names());
      await page.click('#v-find .chips[aria-label="立場"] button:has-text("すべて")');
      // 例でためす：子育て中の会社員
      await page.click('#v-find button:has-text("例でためす：子育て中の会社員")');
      await page.waitForSelector('#v-find .seg button[aria-pressed="true"]:has-text("あなたに合う制度")');
      const person = await names();
      check(where, '例（会社員）：あなたに合う制度が上に並ぶ', person[0] === '児童手当' && person.length === data.programs.length, person.slice(0, 4));
      check(where, '例（会社員）：判定の理由が付く', (await count('#v-find .match')) === data.programs.length && (await count('#v-find .match.high')) === 2, await count('#v-find .match.high'));
      check(where, '例（会社員）：対象外は折りたたむ', (await text('#v-find details.more summary')) === '対象外の見込みの制度（6件）', await text('#v-find details.more summary'));
      check(where, '設定の要約', (await text('#v-find .pf-bar')).includes('個人 ・ 東京都 ・ 子ども：小・中学生 ・ 会社員・公務員'), await text('#v-find .pf-bar'));
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yukue.profile')));
      check(where, '設定はこの端末に保存する（yukue.profile）', saved && saved.kind === 'person' && saved.pref === '東京都', saved);
      await noOverflow('find（あなたに合う制度）');
      await shot('find-match');
      // 設定を消して、もう1つの例
      await go('me');
      check(where, 'マイページ：合う制度の数', (await page.locator('#v-me .big-n').first().innerText()).startsWith('2'), await page.locator('#v-me .big-n').first().innerText());
      await page.click('#v-me button:has-text("この端末の設定を消す")');
      check(where, '消す前に、もう一度たしかめる', (await count('#v-me button:has-text("もう一度押すと消えます")')) === 1, undefined);
      await page.click('#v-me button:has-text("もう一度押すと消えます")');
      check(where, '設定を消す', (await page.evaluate(() => localStorage.getItem('yukue.profile'))) === null, undefined);
      await page.click('#v-me button:has-text("例でためす：創業2年の個人事業主")');
      check(where, 'マイページ：保存したことを伝える', (await text('#v-me .f-save')) === 'この端末に保存しました', await text('#v-me .f-save'));
      check(where, 'マイページ：事業者の項目が出る', (await page.locator('#pf-staff').inputValue()) === '3' && (await page.locator('#pf-years').inputValue()) === '2', undefined);
      await page.click('#v-me button:has-text("合う制度を見る")');
      await page.waitForSelector('section.view[data-view="find"]');
      const biz = await names();
      check(where, '例（事業主）：一覧が入れ替わる', biz[0] === '小規模事業者持続化補助金（創業型）第4回' && JSON.stringify(biz) !== JSON.stringify(person), biz.slice(0, 4));
      check(where, '例（事業主）：対象の可能性が高いのは2件', (await count('#v-find .match.high')) === 2, await count('#v-find .match.high'));
      // マイページ：項目を変えると、判定が変わる
      await go('me');
      await page.fill('#pf-staff', '30');
      await go('find');
      const after = await names();
      check(where, '従業員を30名にすると、持続化補助金は対象外に回る', after[0] !== '小規模事業者持続化補助金（創業型）第4回', after.slice(0, 3));
      await go('me');
      await page.fill('#pf-staff', '3');
      // ログインの再現
      await page.click('#v-me button:has-text("メールアドレスでログイン")');
      check(where, 'ログインの再現', (await text('#v-me .me-card h2')).startsWith('ログイン中') && (await page.evaluate(() => localStorage.getItem('yukue.login'))) === 'true', undefined);
      check(where, 'ヘッダーの表示が変わる', (await page.locator('.hdr a[href="#me"]').innerText()).trim() === (size.width < 760 ? '' : 'マイページ'), undefined);
      await page.click('#v-me button:has-text("ログアウト")');
      await noOverflow('me（事業者）');

      // Jグランツ
      await go('find');
      await page.click('#v-find .seg button:has-text("受付中の補助金（Jグランツ）")');
      const open = data.jgrants.items.filter(g => !g.end || g.end >= today);
      if (!open.length) {
        check(where, 'Jグランツ：無いときの表示', (await text('#v-find .empty')) === '受付中の補助金は、いまのところありません。', undefined);
      } else {
        check(where, 'Jグランツ：60件まで出す', (await count('#v-find .prog')) === Math.min(60, open.length), { got: await count('#v-find .prog'), open: open.length });
        check(where, 'Jグランツ：件数', (await text('#v-find .ctrl [role="status"]')) === `${open.length.toLocaleString('ja-JP')}件`, await text('#v-find .ctrl [role="status"]'));
        const links = await page.locator('#v-find .prog a.srcl').evaluateAll(as => as.map(a => a.getAttribute('href')));
        check(where, 'Jグランツ：リンクは https だけ', links.length > 0 && links.every(h => h.startsWith('https://')), links.slice(0, 2));
        const card = await page.locator('#v-find .prog').first().innerText();
        check(where, 'Jグランツ：上限額と締切', /上限 [\d,.]+(万|億)|上限額の記載なし/.test(card) && /締切\s*((\d+年)?\d+月\d+日（(あと\d+日|きょうまで)）|記載なし)/.test(card), card.slice(0, 200));
        const areas = await page.locator('#jgArea option').allInnerTexts();
        check(where, 'Jグランツ：地域の選択肢はデータから作る', areas.length >= 2 && areas[0] === 'すべての地域', areas.slice(0, 5));
        const area = areas.find(a => a !== 'すべての地域' && a !== '全国') || areas[1];
        await page.selectOption('#jgArea', area);
        const parts = g => (g.area || '').split(/[/／、,，]/).map(s => s.trim());
        const inArea = open.filter(g => parts(g).includes(area)).length;
        check(where, `Jグランツ：地域「${area}」で絞る`, (await count('#v-find .prog')) === Math.min(60, inArea), { got: await count('#v-find .prog'), inArea });
        await page.selectOption('#jgArea', '');
        const word = open[0].title.replace(/[【】「」（）()\[\]［］]/g, ' ').split(/\s+/).filter(w => w.length >= 3)[0] || open[0].title.slice(0, 3);
        await page.fill('#jgQ', word);
        const hit = open.filter(g => norm(`${g.title}\n${g.area}`).includes(norm(word))).length;
        check(where, `Jグランツ：キーワード「${word}」で絞る`, (await count('#v-find .prog')) === Math.min(60, hit), { got: await count('#v-find .prog'), hit });
        await page.fill('#jgQ', 'このことばはどこにもないはず');
        check(where, 'Jグランツ：合うものがないとき', (await text('#v-find .empty')) === 'この条件に合う補助金は、いまのところありません。', undefined);
        await page.fill('#jgQ', '');
        if (open.length > 60) {
          await page.click('#v-find .feed-more button');
          check(where, 'Jグランツ：もっと見る', (await count('#v-find .prog')) === Math.min(120, open.length), await count('#v-find .prog'));
        }
        await noOverflow('find（Jグランツ）');
        await shot('find-jgrants');
      }
      await page.click('#v-find .seg button:has-text("すべての制度")');

      /* ---------- 申請の準備 ---------- */
      const target = data.programs.find(p => p.apply && p.apply.draft);
      if (target) {
        await page.locator(`[id="prog-${target.id}"] button:has-text("申請の準備をする")`).click();
        await page.waitForSelector('section.view[data-view="apply"]');
        const stepNow = () => page.locator('#v-apply .life [aria-current="step"]').innerText();
        check(where, '申請の準備：制度の名前', (await text('#v-apply .vt')) === target.name, undefined);
        check(where, '申請の準備：1 対象の確認', (await stepNow()) === '対象の確認' && (await text('#v-apply .apply-card h2')) === '対象になりそうか', await stepNow());
        check(where, '申請の準備：判定を出す', (await count('#v-apply .apply-card .match')) === 1, undefined);
        await page.click('#v-apply .apply-card button:has-text("次へ：そろえるもの")');
        check(where, '申請の準備：2 そろえるもの', (await stepNow()) === 'そろえるもの' && (await count('#v-apply .needs li')) === target.apply.needs.length, await stepNow());
        check(where, '段階を切り替えたら、いまの段階にフォーカスを移す', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-current') === 'step'), undefined);
        await page.locator('#v-apply .needs input').first().check();
        await page.click('#v-apply .apply-card button:has-text("次へ：下書き")');
        check(where, '申請の準備：3 下書き', (await stepNow()) === '下書き' && (await text('#v-apply .apply-card h2')) === '下書きをつくる', await stepNow());
        await page.click('#v-apply .apply-card button:has-text("AIに下書きを頼む")');
        check(where, '下書き：答えがないと作らない', (await text('#v-apply .f-save')) === '2つの質問に答えてから押してください。', await text('#v-apply .f-save'));
        await page.fill('#aq1', '自家焙煎のコーヒー豆を、店頭とオンラインで販売しています。');
        await page.fill('#aq2', 'オンラインショップを作り直して、定期便を案内するチラシを配りたい。');
        await page.click('#v-apply .apply-card button:has-text("AIに下書きを頼む")');
        const parts = target.apply.draft.parts;
        check(where, '下書き：項目ごとのひな形ができる', (await count('#v-apply textarea[id^="ad-"]')) === parts.length, await count('#v-apply textarea[id^="ad-"]'));
        const draft0 = await page.locator('#v-apply textarea[id^="ad-"]').first().inputValue();
        check(where, '下書き：本人の答えと【要記入】が入る', draft0.includes('自家焙煎のコーヒー豆') && draft0.includes('【要記入：'), draft0);
        check(where, '下書き：できたことを伝える', (await text('#v-apply .f-save')).startsWith('下書きができました。'), await text('#v-apply .f-save'));
        check(where, '下書き：ボタンが「作り直す」に変わる', (await count('#v-apply button:has-text("下書きを作り直す")')) === 1, undefined);
        await noOverflow('apply（下書き）');
        await shot('apply-draft');
        await page.click('#v-apply .apply-card button:has-text("次へ：提出")');
        check(where, '申請の準備：4 提出', (await stepNow()) === '提出' && (await text('#v-apply .apply-card h2')) === '提出する', await stepNow());
        const href = await page.locator('#v-apply .apply-card a.btn-solid').getAttribute('href');
        check(where, '提出：公式の窓口へのリンク', href === target.apply.url && href.startsWith('https://'), href);
        await page.click('#v-apply .apply-card button:has-text("下書きをコピー")');
        await page.waitForTimeout(150);
        const copied = await text('#v-apply .apply-card button:has(svg use[href="#i-copy"]) span');
        check(where, '提出：下書きをコピー', copied === 'コピーしました' || copied === 'コピーできませんでした', copied);
        await page.locator('#adone').check();
        check(where, '提出：記録する', (await text('#v-apply .sw small')).endsWith('に提出ずみとして記録しました。'), await text('#v-apply .sw small'));
        const apps = await page.evaluate(() => JSON.parse(localStorage.getItem('yukue.apps')));
        check(where, '申請の記録はこの端末に保存する（yukue.apps）', apps && apps[target.id] && apps[target.id].step === 3 && !!apps[target.id].done, apps && apps[target.id]);
        await page.click('#v-apply .apply-card button:has-text("戻る")');
        check(where, '申請の準備：戻る', (await stepNow()) === '下書き', await stepNow());
        await page.click('#v-apply .life button:has-text("提出")');
        check(where, '申請の準備：上の段階から直接うつれる', (await stepNow()) === '提出', await stepNow());
        await noOverflow('apply（提出）');
        await go('me');
        check(where, 'マイページに記録が残る', (await text('#v-me .me-col:nth-child(2) .me-card:nth-child(3)')).includes('に提出ずみ'), undefined);
        // 読み込み直しても残る
        await page.reload();
        await page.waitForSelector('section.view[data-view="me"]');
        check(where, '読み込み直しても、設定と記録が残る', (await text('#v-me .me-col:nth-child(2) .me-card:nth-child(3)')).includes('に提出ずみ') && (await count('#pf-staff')) === 1, undefined);
      }

      /* ---------- AIに聞く ---------- */
      if (isOverlay) await closeDock();
      await go('home');
      await openDock();
      check(where, 'AIに聞く：答え方の表示', (await text('.dock .dock-t .tag')) === 'かんたん応答（試作）', await text('.dock .dock-t .tag'));
      const ctxLine = (await text('.dock .ctx')).replace(/\s+/g, '');
      check(where, 'AIに聞く：いま見ている画面', ctxLine === 'いま見ている画面：ホーム', ctxLine);
      const debt = data.budget.use.find(u => u.id === 'debt');
      await page.click('.dock .sugg button:has-text("国の借金の返済にいくら使っている？")');
      await page.waitForSelector('.dock .msg.ai .act', { timeout: 15000 });
      const answer = await page.locator('.dock .msg.ai .bub').last().innerText();
      check(where, 'チャット：質問の例に答える', debt ? answer.includes(`${debt.long || debt.name}は`) && answer.includes('兆円') : answer.length > 20, answer.slice(0, 80));
      check(where, 'チャット：答えに図と出典が付く', (await count('.dock .msg.ai .fig .hb')) >= 2 && (await count('.dock .msg.ai .msrc')) === 1, undefined);
      check(where, 'チャット：画面を動かす', (await page.evaluate(() => location.hash)) === '#flow' && (await count('section.view[data-view="flow"]')) === 1, await page.evaluate(() => location.hash));
      if (debt) check(where, 'チャット：流れ図でその項目を開く', (await text('.crumb .cur')) === debt.name, await text('.crumb .cur'));
      check(where, 'チャット：質問の例が画面に合わせて変わる', (await page.locator('.dock .sugg button').first().innerText()).includes('は何に使われているの？'), undefined);
      if (isOverlay) {
        await page.click('.dock .msg.ai .act');
        await page.waitForSelector('#shell:not(.dock-open)');
        check(where, 'チャット：答えのボタンで、かぶせた画面を閉じて見せる', (await count('section.view[data-view="flow"]')) === 1, undefined);
        await openDock();
      }
      // 入力して聞く
      await page.fill('#q', 'きょうの動きをまとめて教えて');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.dock .msg.ai .act').length >= 2, null, { timeout: 15000 });
      check(where, 'チャット：入力して聞くと、政策の動きを開く', (await page.evaluate(() => location.hash)) === '#updates', await page.evaluate(() => location.hash));
      check(where, 'チャット：入力欄は空に戻る', (await page.locator('#q').inputValue()) === '', undefined);
      check(where, 'チャット：会話が積み重なる', (await count('.dock .msg.user')) === 2 && (await count('.dock .msg.ai')) === 3, undefined);
      // 設定を使った答え
      await page.fill('#q', '私に合う制度は？');
      await page.click('.dock .send');
      await page.waitForFunction(() => document.querySelectorAll('.dock .msg.ai .act').length >= 3, null, { timeout: 15000 });
      check(where, 'チャット：設定に合う制度を答えて、一覧を開く', (await page.evaluate(() => location.hash)) === '#find' && (await page.locator('.dock .msg.ai .bub').last().innerText()).includes('いまの設定（'), undefined);
      await noOverflow('find（チャットのあと）');
      await shot('chat');
      if (isOverlay) await closeDock();

      /* ---------- このサイトについて ---------- */
      await go('about');
      const aboutText = await text('#v-about');
      check(where, 'このサイトについて：サンプルの説明', aboutText.includes(data.budget.fy.sampleNote) && aboutText.includes('サンプルの値'), undefined);
      if (data.run && data.run.sources.length) {
        const rowTexts = (await page.locator('#v-about table.tbl tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
        check(where, 'このサイトについて：収集元の表', rowTexts.length === data.run.sources.length, rowTexts.length);
        const ng = data.run.sources.filter(s => !s.ok).length;
        check(where, 'このサイトについて：失敗した収集元の印', (await count('#v-about .st.fail')) === ng && (await count('#v-about .st.open')) === data.run.sources.length - ng, undefined);
        const listed = {};
        for (const u of data.updates.items) listed[u.sourceId] = (listed[u.sourceId] || 0) + 1;
        const wrong = [];
        data.run.sources.forEach((src, i) => {
          const row = rowTexts[i] || '';
          const n = (listed[src.id] || 0).toLocaleString('ja-JP');
          if (!row.includes(` ${n}件`)) wrong.push(`${src.id}: 掲載中 ${n}件 がない → ${row}`);
          if (src.ok && src.unchanged && (!row.includes('変化なし') || row.includes('取得 0件'))) wrong.push(`${src.id}: 変化なし → ${row}`);
          if (src.ok && !src.unchanged && !row.includes(`取得 ${src.fetched.toLocaleString('ja-JP')}件 ・ 新着 ${src.added.toLocaleString('ja-JP')}件`)) wrong.push(`${src.id}: 件数 → ${row}`);
          if (src.checkedAt) {
            const c = jst(src.checkedAt);
            if (!row.includes(`${Number(c.ymd.slice(5, 7))}月${Number(c.ymd.slice(8, 10))}日 ${c.time} に確認`)) wrong.push(`${src.id}: 確認の日時 → ${row}`);
          }
        });
        check(where, 'このサイトについて：情報源ごとの掲載中の件数、変化なし、確認の日時', wrong.length === 0, wrong.slice(0, 4));
        const sum = (await text('#v-about .run-sum')).replace(/\s+/g, ' ');
        const f = jst(data.run.finishedAt);
        check(where, 'このサイトについて：直近の収集の日時（日本時間）', sum.includes(`直近の収集 ${f.ymd.slice(0, 4)}年${Number(f.ymd.slice(5, 7))}月${Number(f.ymd.slice(8, 10))}日 ${f.time}`), sum);
        check(where, 'このサイトについて：掲載中の動きは、読み込んだ一覧から数える', sum.includes(`掲載中の動き ${data.updates.items.length.toLocaleString('ja-JP')}件`) && sum.includes(`新しく加わった動き ${data.run.totals.added.toLocaleString('ja-JP')}件`) && !sum.includes('取得'), sum);
      } else {
        check(where, 'このサイトについて：収集の記録がないときの表示', aboutText.includes('収集の記録は、まだありません。') || aboutText.includes('収集の記録を読み込めませんでした。'), undefined);
      }
      check(where, 'このサイトについて：ログイン・プロフィール・AIでの申請', aboutText.includes('ログイン・プロフィール・AIでの申請') && aboutText.includes('提出は本人が行う'), undefined);
      const aboutLinks = await page.locator('#v-about a[target="_blank"]').evaluateAll(as => as.map(a => a.getAttribute('href')));
      check(where, 'このサイトについて：外へのリンクは https だけ', aboutLinks.every(h => h.startsWith('https://')), aboutLinks.filter(h => !h.startsWith('https://')));
      await noOverflow('about');

      /* ---------- AIとつなぐ ---------- */
      await go('connect');
      check(where, 'AIとつなぐ：会話の中の図', (await count('#v-connect svg.fl g.nd')) > 3, await count('#v-connect svg.fl g.nd'));
      check(where, 'AIとつなぐ：道具の一覧', (await count('#v-connect .tool')) === 8, await count('#v-connect .tool'));
      await page.click('#v-connect .url button');
      await page.waitForTimeout(100);
      check(where, 'AIとつなぐ：URLをコピー', ['コピーしました', '選択しました'].includes(await text('#v-connect .url button span')), await text('#v-connect .url button span'));
      await page.click('#v-connect .widget-h button');
      await page.waitForSelector('section.view[data-view="flow"]');
      check(where, 'AIとつなぐ：「ゆくえで開く」で内訳を開く', (await text('.crumb .cur')) === '防衛', await text('.crumb .cur'));

      /* ---------- 戻る・進む、直接のURL ---------- */
      await page.goBack();
      await page.waitForSelector('section.view[data-view="connect"]');
      check(where, 'ブラウザーの「戻る」で前の画面に戻る', (await count('section.view[data-view="connect"]')) === 1, undefined);
      await page.goto(BASE + '#notes');
      await page.waitForSelector('section.view');
      check(where, '昔の #notes は「このサイトについて」を出す', (await count('section.view[data-view="about"]')) === 1, undefined);
      await page.goto(BASE + '#nothing');
      await page.waitForSelector('section.view');
      check(where, '知らない # はホームを出す', (await count('section.view[data-view="home"]')) === 1, undefined);

      // あと片づけ（次の組み合わせに持ちこさない）
      await page.evaluate(() => localStorage.clear());

      check(where, 'コンソールにエラーや警告がない', errors.length === 0, errors.slice(0, 5));
      summary.push({ where, errors: errors.length, blockedExternal: [...new Set(blockedErrors.map(u => new URL(u).host))] });
      await context.close();
    }
  }

  /* ---------- 作ったデータで確かめる（いまのデータに無い形も、型のとおりに出るか） ---------- */
  for (const size of SIZES) {
    const where = `作ったデータ/${size.name}`;
    console.log(`\n== ${where} ==`);
    const day = n => new Date(Date.now() + 9 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
    const base = { sourceId: 'syn', firstSeen: '2026-11-24T00:00:00.000Z', importance: 50, enriched: 'rules', links: [], summary: '', ministry: '' };
    const fragment = 'https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/keika/1DE342E.htm#:~:text=%E6%B3%95%E5%BE%8B%E6%A1%88';
    const long = 'https://www.example.go.jp/' + 'a'.repeat(260);
    const synUpdates = {
      generatedAt: '2026-12-31T15:30:00.000Z',
      items: [
        {
          ...base,
          id: 'syn:ai',
          date: today,
          type: 'law',
          theme: 'social',
          importance: 90,
          enriched: 'ai',
          title: '給付金の請求期限を延ばす法案',
          originalTitle: '特定の給付金の支給に関する特別措置法の一部を改正する法律案',
          summary: 'AIが整えた要約です。',
          ministry: '内閣提出の法案',
          amount: '約10億円',
          deadline: day(10),
          stage: { steps: ['提出', '審議', '成立'], index: 1, label: '審議中' },
          qa: { what: '請求できる期限が延びる。', who: '対象の人。', when: '成立すれば来年から。' },
          links: [
            { name: '衆議院 議案経過', url: fragment },
            { name: 'http のリンク', url: 'http://example.go.jp/' },
            { name: 'あぶないリンク', url: 'javascript:alert(1)' }
          ]
        },
        { ...base, id: 'syn:min', date: today, type: 'news', theme: 'other', importance: 10, title: 'いちばん少ない項目' },
        { ...base, id: 'syn:odd', date: today, type: 'mystery', theme: 'unknown', title: '知らない種類と分野の発表', summary: '要約。', ministry: 'どこかの省', links: [{ name: '発表', url: 'https://example.go.jp/a' }] },
        { ...base, id: 'syn:noise', date: today, type: 'news', theme: 'other', importance: 99, noise: true, title: '人事異動のお知らせ' },
        { ...base, id: 'syn:long', date: day(-1), type: 'news', theme: 'other', title: long, summary: 'X'.repeat(300), ministry: 'M'.repeat(90), amount: '9'.repeat(60) },
        { ...base, id: 'syn:today', date: day(-1), type: 'grant', theme: 'industry', title: 'きょうが締切の補助金', deadline: today, ministry: 'Jグランツ掲載' },
        { ...base, id: 'syn:past', date: day(-2), type: 'grant', theme: 'industry', title: '締切を過ぎた補助金', deadline: day(-1) },
        { ...base, id: 'syn:same', date: day(-2), type: 'law', theme: 'edu', title: '題と同じ正式な名前', originalTitle: '題と同じ正式な名前' },
        { title: 'IDのない、こわれた項目' },
        { ...base, id: 'syn:baddate', date: 'きのう', type: 'news', theme: 'other', title: '日付の読めない項目' },
        'もじれつ',
        null
      ]
    };
    const synBriefing = { date: today, generatedAt: synUpdates.generatedAt, method: 'ai', items: [{ id: 'syn:ai', text: 'AIがまとめた、きょうの動き。' }, { id: 'もう無い', text: '消えた動き' }] };
    const synRun = {
      startedAt: '2026-12-31T15:00:00.000Z',
      finishedAt: '2026-12-31T15:30:00.000Z',
      sources: [
        { id: 'syn', name: 'うまくいった収集元', kind: 'rss', url: 'https://example.go.jp/news.rdf', ok: true, fetched: 1234, added: 5, ms: 800, checkedAt: '2026-12-31T15:29:00.000Z', failures: 0, lastOk: '2026-12-31T15:29:00.000Z' },
        { id: 'ng', name: '失敗した収集元', kind: 'html', url: 'http://example.go.jp/', ok: false, fetched: 0, added: 0, error: 'HTTP 503 ' + 'e'.repeat(120), ms: 30000, checkedAt: '2026-12-31T15:29:30.000Z', failures: 3, lastOk: '2026-12-30T00:00:00.000Z' },
        { id: 'once', name: '1回だけ失敗した収集元', kind: 'html', url: '', ok: false, fetched: 0, added: 0, error: '時間切れ', ms: 30000, failures: 1 },
        { id: 'same', name: '変わっていない収集元', kind: 'rss', url: '', ok: true, fetched: 0, added: 0, unchanged: true, ms: 300, checkedAt: '2026-12-25T03:00:00.000Z' },
        { id: 'jgrants', name: 'APIの収集元', kind: 'api', url: '', ok: true, fetched: 10, added: 0, ms: 5 }
      ],
      totals: { fetched: 1244, added: 5, items: 6 }
    };
    const prefs = '北海道 / 青森県 / 岩手県 / 宮城県 / 秋田県 / 山形県 / 福島県 / 茨城県 / 栃木県 / 群馬県 / 埼玉県 / 千葉県 / 東京都';
    const synJ = {
      generatedAt: synUpdates.generatedAt,
      items: [
        { id: 'j1', title: '上限が億円の補助金', area: '全国', maxAmount: 25000000000, start: day(-10), end: day(40), employees: null, url: 'https://www.jgrants-portal.go.jp/subsidy/j1' },
        { id: 'j2', title: '地域がたくさんある補助金', area: prefs, maxAmount: 2000000, start: null, end: day(0), employees: '20名以下', url: 'http://example.go.jp/j2' },
        { id: 'j3', title: 'L'.repeat(200), area: 'A'.repeat(120), maxAmount: null, start: null, end: null, employees: null, url: '' },
        { id: 'j4', title: '受付が終わった補助金', area: '東京都', maxAmount: 100, start: null, end: day(-1), employees: null, url: 'https://www.jgrants-portal.go.jp/subsidy/j4' },
        { id: 'j5', title: 'これから受付の補助金', area: '東京都', maxAmount: 123456789, start: day(5), end: day(400), employees: null, url: 'https://www.jgrants-portal.go.jp/subsidy/j5' },
        { title: 'IDのない補助金' }
      ]
    };
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, locale: 'ja-JP' });
    const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(BASE)) return route.abort();
      if (url.endsWith('/data/updates/latest.json')) return route.fulfill(json(synUpdates));
      if (url.endsWith('/data/briefing.json')) return route.fulfill(json(synBriefing));
      if (url.endsWith('/data/runs/latest.json')) return route.fulfill(json(synRun));
      if (url.endsWith('/data/programs/jgrants.json')) return route.fulfill(json(synJ));
      if (url.endsWith('/data/calendar.json')) return route.fulfill(json([{ date: day(3), when: '', title: 'when のない予定', note: '', updateId: 'syn:ai' }, { title: '日付のない予定' }]));
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', m => {
      if ((m.type() === 'error' || m.type() === 'warning') && !(m.location().url || '').startsWith('https://fonts.')) errors.push(m.text());
    });
    page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
    const noOverflow = async label => {
      const m = await page.evaluate(() => {
        const win = window.innerWidth;
        const wide = [];
        if (document.documentElement.scrollWidth > win) {
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > win + 1 && r.width > 0 && !el.closest('.flow-scroll, .tbl-wrap, .dock, .url')) wide.push(`${el.tagName.toLowerCase()}.${el.className && el.className.baseVal === undefined ? el.className : ''} ${Math.round(r.right)}`);
          }
        }
        return { doc: document.documentElement.scrollWidth, win, wide: wide.slice(0, 6) };
      });
      check(where, `横にはみ出さない：${label}`, m.doc <= m.win, m);
    };
    const go = async view => {
      await page.evaluate(v => {
        window.location.hash = v;
      }, view);
      await page.waitForSelector(`section.view[data-view="${view}"]`);
      await page.waitForTimeout(100);
    };
    await page.goto(BASE + '#home');
    await page.waitForSelector('section.view[data-view="home"]');
    if (await page.locator('#shell.dock-open').count()) await page.click('.dock .icon-btn');

    // ホーム：日付は日本時間（UTC の 12月31日 15:30 は、日本では 1月1日 0:30）
    const eyebrow = await page.locator('.brief .eyebrow').innerText();
    check(where, '年をまたぐ更新日時も、日本時間で出す', eyebrow === '2027.01.01 金 ・ 00:30 更新', eyebrow);
    check(where, 'きょうの動き：見つからない id は飛ばす', (await page.locator('.brief-item').count()) === 1, await page.locator('.brief-item').count());
    check(where, 'きょうの動き：AIがまとめたときは「AI要約」', (await page.locator('.brief-foot .tag').innerText()) === 'AI要約', undefined);
    check(where, 'きょうの動き：一次情報は https のリンクだけを数える', (await page.locator('.brief-foot').innerText()).includes('一次情報 1件にもとづく'), await page.locator('.brief-foot').innerText());
    const rows = await page.locator('.home-low section').nth(1).locator('.row').allInnerTexts();
    check(where, 'これからの予定：過ぎた締切は出さず、同じ動きは重ねない', rows.length === 2 && rows[0].includes('きょうが締切の補助金') && rows[1].includes('when のない予定'), rows);
    check(where, 'これからの予定：when が無ければ日付から作る', /^\d\d\.\d\d [日月火水木金土]/.test(rows[1].trim()), rows[1]);
    await noOverflow('home');

    // 政策の動き
    await go('updates');
    const idsShown = await page.evaluate(() => [...document.querySelectorAll('.up')].map(a => a.id));
    check(where, 'こわれた項目は捨て、ふだん外す発表は出さない', JSON.stringify(idsShown) === JSON.stringify(['up-syn:ai', 'up-syn:odd', 'up-syn:min', 'up-syn:long', 'up-syn:today', 'up-syn:past', 'up-syn:same']), idsShown);
    await noOverflow('updates（長い文字列）');
    const meta = await page.locator('[id="up-syn:ai"] .up-meta').innerText();
    check(where, 'AIが整えた項目：「AI要約」の印、金額、締切', meta.includes('AI要約') && meta.includes('約10億円') && /締切 (\d+年)?\d+月\d+日（あと10日）/.test(meta), meta);
    check(where, 'AIが整えた項目：段階', (await page.locator('[id="up-syn:ai"] .up-stage').innerText()).trim() === '審議中' && (await page.locator('[id="up-syn:ai"] .steps i').count()) === 3, undefined);
    await page.locator('[id="up-syn:ai"] .up-h').click();
    const aiBody = page.locator('[id="up-syn:ai"] .up-body');
    check(where, '正式な名前を出す', (await aiBody.innerText()).includes('正式な名前：特定の給付金の支給に関する特別措置法の一部を改正する法律案'), undefined);
    const hrefs = await aiBody.locator('a').evaluateAll(as => as.map(a => a.getAttribute('href')));
    check(where, 'リンクは https だけ。#:~:text= はそのまま', JSON.stringify(hrefs) === JSON.stringify([fragment]), hrefs);
    check(where, '段階の並び', (await aiBody.innerText()).includes('段階：提出 → 【審議】 → 成立'), undefined);
    const odd = await page.locator('[id="up-syn:odd"]').innerText();
    check(where, '知らない種類は「発表」、知らない分野は「その他」', odd.includes('発表') && odd.includes('その他'), odd);
    check(where, '段階のない項目には、段階の目盛りを出さない', (await page.locator('[id="up-syn:odd"] .up-stage').count()) === 0, undefined);
    await page.locator('[id="up-syn:min"] .up-h').click();
    check(where, '何もない項目を開いたとき', (await page.locator('[id="up-syn:min"] .up-body').innerText()).trim() === 'この発表には、一次情報のリンクがありません。', await page.locator('[id="up-syn:min"] .up-body').innerText());
    check(where, 'きょうが締切', (await page.locator('[id="up-syn:today"] .up-meta').innerText()).includes('（きょうまで）'), undefined);
    check(where, '過ぎた締切は出さない', !(await page.locator('[id="up-syn:past"] .up-meta').innerText()).includes('締切'), undefined);
    await page.locator('[id="up-syn:same"] .up-h').click();
    check(where, '題と同じ「正式な名前」は出さない', !(await page.locator('[id="up-syn:same"]').innerText()).includes('正式な名前：'), undefined);
    await page.locator('#upAll').check();
    check(where, 'すべての発表を表示：人事なども出る（同じ日は重要度の高い順で先頭）', (await page.locator('.up').first().getAttribute('id')) === 'up-syn:noise', await page.locator('.up').first().getAttribute('id'));
    await page.locator('#upAll').uncheck();
    await page.fill('#upQ', 'どこかの省');
    check(where, 'キーワード：発表元でも見つかる', (await page.locator('.up').count()) === 1, undefined);
    await page.fill('#upQ', '');
    await noOverflow('updates（開いたあと）');
    await page.screenshot({ path: SHOTS ? path.join(SHOTS, `synthetic-updates-${size.name}.png`) : undefined, fullPage: true });

    // Jグランツ
    await go('find');
    await page.click('#v-find .seg button:has-text("受付中の補助金（Jグランツ）")');
    const cards = await page.locator('#v-find .prog').allInnerTexts();
    check(where, 'Jグランツ：受付が終わったものと、こわれた項目は出さない', cards.length === 4, cards.length);
    check(where, 'Jグランツ：締切の近い順（締切のないものは最後）', cards[0].includes('地域がたくさんある補助金') && cards[3].includes('LLLL'), cards.map(c => c.slice(0, 30)));
    check(where, 'Jグランツ：万円と、きょうまで', cards[0].includes('上限 200万円') && cards[0].includes('（きょうまで）') && cards[0].includes('北海道、青森県、ほか11地域') && cards[0].includes('20名以下'), cards[0]);
    check(where, 'Jグランツ：億円と、あとN日', cards[1].includes('上限 250億円') && cards[1].includes('（あと40日）'), cards[1]);
    check(where, 'Jグランツ：これから受付', cards[2].includes('受付前') && cards[2].includes('上限 1億2,346万円'), cards[2]);
    check(where, 'Jグランツ：上限額や締切が分からないとき', cards[3].includes('上限額の記載なし') && cards[3].includes('受付中'), cards[3].slice(0, 80));
    const jHrefs = await page.locator('#v-find .prog a').evaluateAll(as => as.map(a => a.getAttribute('href')));
    check(where, 'Jグランツ：https でないリンクは出さない', JSON.stringify(jHrefs) === JSON.stringify(['https://www.jgrants-portal.go.jp/subsidy/j1', 'https://www.jgrants-portal.go.jp/subsidy/j5']), jHrefs);
    const opts = await page.locator('#jgArea option').allInnerTexts();
    check(where, 'Jグランツ：地域の選択肢', opts[1] === '全国' && opts.includes('東京都') && opts.includes('宮城県') && opts.length === 16, opts);
    await page.selectOption('#jgArea', '宮城県');
    check(where, 'Jグランツ：並んだ地域の1つでも絞れる', (await page.locator('#v-find .prog').count()) === 1, undefined);
    await page.selectOption('#jgArea', '');
    await noOverflow('find（Jグランツ、長い文字列）');
    await page.screenshot({ path: SHOTS ? path.join(SHOTS, `synthetic-jgrants-${size.name}.png`) : undefined, fullPage: true });

    // このサイトについて
    await go('about');
    const about = await page.locator('#v-about').innerText();
    const aboutRows = (await page.locator('#v-about table.tbl tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
    check(where, '収集元：行の数と、失敗の印', aboutRows.length === 5 && (await page.locator('#v-about .st.fail').count()) === 2, aboutRows.length);
    check(where, '収集元：失敗の理由、続けて失敗した回数、最後に取得できた日時', aboutRows[1].includes('失敗') && aboutRows[1].includes('3回つづけて失敗 ・ HTTP 503') && aboutRows[1].includes('最後に取得できたのは 2026年12月30日 09:00'), aboutRows[1].slice(0, 160));
    check(where, '収集元：1回だけの失敗には、回数を出さない', aboutRows[2].includes('時間切れ') && !aboutRows[2].includes('つづけて') && !aboutRows[2].includes('最後に取得'), aboutRows[2]);
    check(where, '収集元：変わっていないときは「変化なし」', aboutRows[3].includes('変化なし') && !aboutRows[3].includes('取得 0件') && aboutRows[3].includes('2026年12月25日 12:00 に確認'), aboutRows[3]);
    check(where, '収集元：取り方の呼び名', about.includes('RSS') && about.includes('ページの巡回') && about.includes('API'), undefined);
    check(where, '収集元：件数は桁区切り', aboutRows[0].includes('取得 1,234件 ・ 新着 5件') && aboutRows[0].includes('2027年1月1日 00:29 に確認'), aboutRows[0]);
    check(where, '収集元：掲載中の件数は、読み込んだ動きから数える', aboutRows[0].includes(' 8件 ') && aboutRows[1].includes(' 0件 ') && aboutRows[4].includes('ほかに、受付中の補助金 4件'), [aboutRows[0], aboutRows[4]]);
    const runSum = (await page.locator('#v-about .run-sum').innerText()).replace(/\s+/g, ' ');
    check(where, '収集元：まとめの行（日本時間、掲載中は読み込んだ一覧から）', runSum.includes('直近の収集 2027年1月1日 00:30') && runSum.includes('新しく加わった動き 5件') && runSum.includes('掲載中の動き 8件') && runSum.includes('失敗している情報源 2件') && !runSum.includes('1,244'), runSum);
    const srcLinks = await page.locator('#v-about table a').evaluateAll(as => as.map(a => a.getAttribute('href')));
    check(where, '収集元：https のURLだけリンクにする', JSON.stringify(srcLinks) === JSON.stringify(['https://example.go.jp/news.rdf']), srcLinks);
    await noOverflow('about（長い理由）');

    // チャット：作ったデータでも答える
    if (size.width < 760) await page.click('.tabbar button');
    else await page.click('.hdr .btn-ai');
    await page.fill('#q', '「給付金の請求期限を延ばす法案」をわかりやすく説明して');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.dock .msg.ai .act');
    const ans = await page.locator('.dock .msg.ai .bub').last().innerText();
    check(where, 'チャット：1件の動きを説明して開く', ans.includes('AIが整えた要約です。') && ans.includes('いまの段階は「審議中」です。') && (await page.evaluate(() => location.hash)) === '#updates', ans);
    check(where, 'コンソールにエラーや警告がない', errors.length === 0, errors.slice(0, 5));
    await context.close();
  }

  /* ---------- データが読めないとき ---------- */
  {
    const where = '読み込みの失敗';
    console.log(`\n== ${where} ==`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let fail = true;
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(BASE)) return route.abort();
      if (fail && url.includes('/data/budget/')) return route.fulfill({ status: 503, body: 'busy' });
      if (fail && url.includes('/data/updates/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"items": [' });
      if (url.includes('/data/programs/jgrants.json')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(BASE + '#flow');
    await page.waitForSelector('.state[role="alert"]');
    const msg = await page.locator('.state').innerText();
    check(where, '読めなかったことと、理由を伝える', msg.includes('データを読み込めませんでした') && msg.includes('data/budget/fy2026.json') && msg.includes('503') && msg.includes('JSON として読めませんでした'), msg);
    check(where, '上のナビは出ている', (await page.locator('.hdr .nav a[aria-current="page"]').innerText()) === 'お金の流れ', undefined);
    fail = false;
    await page.click('.state button');
    await page.waitForSelector('section.view[data-view="flow"]');
    check(where, '「もう一度読み込む」で読み直せる', (await page.locator('svg.fl g.nd').count()) > 5, undefined);
    // 必須でないファイル（Jグランツ）が無くても、画面は出る
    await page.evaluate(() => {
      window.location.hash = 'find';
    });
    await page.waitForSelector('section.view[data-view="find"]');
    await page.click('#v-find .seg button:has-text("受付中の補助金（Jグランツ）")');
    check(where, 'Jグランツが読めなくても、ほかは動く', (await page.locator('#v-find .empty').innerText()) === '受付中の補助金は、いまのところありません。', undefined);
    await page.evaluate(() => {
      window.location.hash = 'about';
    });
    await page.waitForSelector('section.view[data-view="about"]');
    check(where, '読めなかったファイルを「このサイトについて」に出す', (await page.locator('#v-about').innerText()).includes('読み込めなかったデータ：programs/jgrants.json'), undefined);
    await context.close();
  }

  /* ---------- 読み込み中、動きを減らす設定 ---------- */
  {
    const where = '読み込み中・動きを減らす';
    console.log(`\n== ${where} ==`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    let release;
    const gate = new Promise(r => (release = r));
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (!url.startsWith(BASE)) return route.abort();
      if (url.includes('/data/')) await gate;
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForSelector('.state[role="status"]');
    check(where, '読み込み中の表示', (await page.locator('.state').innerText()).trim() === 'データを読み込んでいます…', undefined);
    release();
    await page.waitForSelector('section.view[data-view="home"]');
    const t0 = Date.now();
    await page.click('.dock .sugg button >> nth=1');
    await page.waitForSelector('.dock .msg.ai .act');
    check(where, '動きを減らす設定では、答えを一度に出す', Date.now() - t0 < 1500, Date.now() - t0);
    const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.fl .rib')).transitionDuration);
    check(where, '動きを減らす設定では、図の変化を待たせない', dur === '0s', dur);
    await context.close();
  }

  await browser.close();

  console.log('\n---- まとめ ----');
  for (const s of summary) {
    console.log(`${s.where}: コンソールのエラー・警告 ${s.errors} 件 ／ 止めた外へのリクエスト ${s.blockedExternal.join(', ') || 'なし'}`);
  }
  console.log(`確認 ${checks} 件、うち失敗 ${failures.length} 件`);
  if (failures.length) {
    for (const f of failures) console.log('  - ' + f);
    process.exitCode = 1;
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
