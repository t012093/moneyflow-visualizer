import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** 空白をそろえる。改行は残す。 */
export function squash(s: string): string {
  return s.replace(/[ \t 　\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/** HTML をテキストにする。二重にエスケープされた説明文（&lt;br/&gt;）にも対応する。 */
export function stripTags(html: string): string {
  let s = html;
  for (let i = 0; i < 2; i++) {
    s = decodeEntities(s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '));
  }
  return squash(s);
}

/** 全角の英数字だけを半角にする（記号やかっこは、日本語の組み方のまま残す）。 */
export function toHalfWidth(s: string): string {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function cleanTitle(s: string): string {
  return toHalfWidth(stripTags(s).replace(/\n/g, ' ')).replace(/ {2,}/g, ' ').trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const JST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 日本時間での日付（YYYY-MM-DD）。 */
export function jstDate(d: Date): string {
  return JST.format(d);
}

/** フィードの日時を読む。秒が抜けた「2026-11-20T15:00:Z」のような書き方も受ける。 */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim()
    .replace(/T(\d{2}):(\d{2}):?(Z|[+-]\d{2}:?\d{2})$/, 'T$1:$2:00$3')
    // 「Tue, 24 Nov 2026 17:00:00 JST」のように、時差を略号で書くフィードがある
    .replace(/\s+JST$/i, ' +0900');
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ERA: Record<string, number> = { 令和: 2018, 平成: 1988, 昭和: 1925 };
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** 「令和 8年11月 6日」「2026/11/21」「2026年11月21日」を YYYY-MM-DD にする。読めなければ null。 */
export function parseJaDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = toHalfWidth(s).replace(/\s+/g, '');
  let m = t.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
  if (m) return ymd(ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2])), Number(m[3]), Number(m[4]));
  m = t.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** 「12月14日」のような、画面に出す短い日付。 */
export function shortJaDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 文中の最初の金額（「6,519億円」「1兆1,481億円」「200万円」）を取り出す。 */
export function extractAmount(text: string): string | undefined {
  const m = toHalfWidth(text).match(/約?\d[\d,.]*\s*(?:兆|億|万)(?:\d[\d,]*億)?(?:\d[\d,]*万)?円/);
  return m ? m[0].replace(/\s+/g, '') : undefined;
}

export function sha1(data: string | Uint8Array): string {
  return createHash('sha1').update(data).digest('hex');
}

export function shortId(s: string): string {
  return sha1(s).slice(0, 12);
}

/** 重複の判定に使うURL。#以下と計測用の引数を落とし、http は https にそろえる。 */
export function canonicalUrl(u: string, base?: string): string {
  try {
    const x = new URL(u.trim(), base);
    x.hash = '';
    if (x.protocol === 'http:') x.protocol = 'https:';
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u.trim();
  }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
