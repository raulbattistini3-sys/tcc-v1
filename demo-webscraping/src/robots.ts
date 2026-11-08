// robots.txt per RFC 9309: the group for our product token if there is one, else `*`; the longest
// matching rule wins, and `allow` wins a tie; `*` matches any run of characters and a trailing `$` anchors.
// Unreachable or 5xx robots.txt: assume everything is disallowed. 4xx: the RFC lets a crawler proceed
// (a store that blocks bots still blocks the page itself, which the scraper then records as blocked).

export type Rule = { allow: boolean; pattern: string; re: RegExp };
export type Robots = { rules: Rule[]; crawlDelaySec: number | null; status: "ok" | "unavailable" | "unreachable" };

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map(escape).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Parses a robots.txt body for one product token (e.g. "tcc-research-bot"). */
export function parseRobots(text: string, token: string): Omit<Robots, "status"> {
  type Group = { agents: string[]; rules: Rule[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === "user-agent") {
      if (!inAgents) groups.push((cur = { agents: [], rules: [], delay: null }));
      cur!.agents.push(value.toLowerCase());
      inAgents = true;
      continue;
    }
    inAgents = false;
    if (!cur) continue;
    if ((field === "allow" || field === "disallow") && value) cur.rules.push({ allow: field === "allow", pattern: value, re: toRegex(value) });
    if (field === "crawl-delay" && Number.isFinite(Number(value))) cur.delay = Number(value);
  }
  const t = token.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && t.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySec: chosen.map((g) => g.delay).find((d) => d !== null) ?? null,
  };
}

/** Whether `pathAndQuery` (e.g. "/celular?page=2") may be fetched. */
export function isAllowed(robots: Pick<Robots, "rules" | "status">, pathAndQuery: string): boolean {
  if (robots.status === "unreachable") return false;
  let best: Rule | null = null;
  for (const r of robots.rules) {
    if (!r.re.test(pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

const cache = new Map<string, Promise<Robots>>();

/** Fetches (once per origin) and parses an origin's robots.txt. */
export function robotsFor(origin: string, token: string, userAgent: string): Promise<Robots> {
  let p = cache.get(origin);
  if (!p) {
    p = (async (): Promise<Robots> => {
      try {
        const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
        if (res.status >= 500) return { rules: [], crawlDelaySec: null, status: "unreachable" };
        if (res.status >= 400) return { rules: [], crawlDelaySec: null, status: "unavailable" };
        return { ...parseRobots(await res.text(), token), status: "ok" };
      } catch {
        return { rules: [], crawlDelaySec: null, status: "unreachable" };
      }
    })();
    cache.set(origin, p);
  }
  return p;
}
