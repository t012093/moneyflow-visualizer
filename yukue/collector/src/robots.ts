/** robots.txt の読み取り（RFC 9309 に沿った最小限の実装）。 */

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  /** Crawl-delay（秒）。書かれていなければ null */
  crawlDelay: number | null;
}

interface Group {
  agents: string[];
  rules: RobotsRules;
}

/** 自分の名前（例：yukue-collector）に当たるグループがあればそれを、なければ * を使う。 */
export function parseRobots(txt: string, agentToken: string): RobotsRules {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: { allow: [], disallow: [], crawlDelay: null } };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' && value) cur.rules.allow.push(value);
    else if (key === 'disallow' && value) cur.rules.disallow.push(value);
    else if (key === 'crawl-delay' && Number.isFinite(Number(value))) cur.rules.crawlDelay = Number(value);
  }
  const token = agentToken.toLowerCase();
  const merge = (gs: Group[]): RobotsRules => ({
    allow: gs.flatMap(g => g.rules.allow),
    disallow: gs.flatMap(g => g.rules.disallow),
    crawlDelay: gs.map(g => g.rules.crawlDelay).find(v => v != null) ?? null
  });
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && token.includes(a)));
  if (mine.length) return merge(mine);
  return merge(groups.filter(g => g.agents.includes('*')));
}

/** 規則の書き方（* と行末の $）を正規表現にして、一致した長さを返す。一致しなければ -1。 */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? body.length : -1;
}

/** いちばん長く一致した規則に従う。同じ長さなら Allow を優先する。 */
export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best = -1;
  let allowed = true;
  for (const p of rules.disallow) {
    const n = matchLength(p, pathWithQuery);
    if (n > best) { best = n; allowed = false; }
  }
  for (const p of rules.allow) {
    const n = matchLength(p, pathWithQuery);
    if (n >= best && n >= 0) { best = n; allowed = true; }
  }
  return allowed;
}
