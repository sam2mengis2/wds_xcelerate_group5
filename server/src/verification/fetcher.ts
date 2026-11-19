// A slow, polite HTTP client for scraping: one request at a time, a pause between requests,
// an honest User-Agent, robots.txt respected, and cookies kept between pages like a browser.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetcherOptions {
  /** Who to contact about the bot, e.g. an email. Put it in SCRAPER_CONTACT. */
  contact: string;
  /** Pause between requests. */
  delayMs?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}

/** True if robots.txt lets `*` (or our bot) fetch `path`. Longest matching rule wins; Allow wins ties. */
export function robotsAllows(robots: string, path: string, agent = 'knockbot'): boolean {
  type Rule = { allow: boolean; path: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;

  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }

  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap(
    (g) => g.rules,
  );
  const toRegex = (p: string) =>
    new RegExp(
      '^' +
        p
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$'),
      'i',
    );

  let best: Rule | null = null;
  for (const rule of rules) {
    if (!toRegex(rule.path).test(path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    )
      best = rule;
  }
  return best ? best.allow : true;
}

export function createFetcher(options: FetcherOptions) {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = options.delayMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const userAgent = `KnockBot/0.1 (UWO student housing project; checks Western Verified listings; contact: ${options.contact})`;
  const cookies = new Map<string, string>();
  const robotsByOrigin = new Map<string, string>();
  let last = 0;

  async function request(url: string, init: RequestInit = {}): Promise<string> {
    const wait = last + delayMs - Date.now();
    if (last && wait > 0) await sleep(wait);
    last = Date.now();

    const headers = new Headers(init.headers);
    headers.set('User-Agent', userAgent);
    headers.set('Accept', 'text/html,application/xhtml+xml');
    if (cookies.size) headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));

    const res = await doFetch(url, {
      ...init,
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair!.indexOf('=');
      if (eq > 0) cookies.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
    if (res.status === 429 || res.status === 503)
      throw new ScrapeError(`${url} asked us to slow down (${res.status}); stopping`);
    if (!res.ok) throw new ScrapeError(`${url} returned ${res.status}`);
    return res.text();
  }

  /** Throws unless robots.txt allows the URL. A missing robots.txt allows everything. */
  async function checkRobots(url: string) {
    const { origin, pathname } = new URL(url);
    if (!robotsByOrigin.has(origin)) {
      let text = '';
      try {
        text = await request(`${origin}/robots.txt`);
      } catch (err) {
        if (!(err instanceof ScrapeError && / returned 404$/.test(err.message))) throw err;
      }
      robotsByOrigin.set(origin, text);
    }
    if (!robotsAllows(robotsByOrigin.get(origin)!, pathname)) {
      throw new ScrapeError(`robots.txt on ${origin} disallows ${pathname}; not scraping it`);
    }
  }

  return {
    async get(url: string) {
      await checkRobots(url);
      return request(url);
    },
    async postForm(url: string, body: URLSearchParams, referer?: string) {
      await checkRobots(url);
      return request(url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(referer ? { Referer: referer } : {}),
        },
      });
    },
  };
}

export type Fetcher = ReturnType<typeof createFetcher>;
