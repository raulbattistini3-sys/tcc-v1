// Site-independent reading of a store's home page, for the sweep over many stores (src/sweep.ts), where
// there are no per-store selectors. Products come from what stores publish for search engines first
// (JSON-LD Product / ItemList / OfferCatalog, schema.org microdata), then from a heuristic: a link with
// an image and a price-looking text in the same small box. Runs inside the page (executeScript), so it
// is self-contained: no imports, no closures.

export type GenericCard = {
  title: string;
  url?: string;
  price?: string;
  currency?: string;
  image?: string;
  rating?: string;
  reviews?: string;
  source: "jsonld" | "microdata" | "heuristic";
};

export type GenericProbe = {
  url: string;
  title: string;
  lang: string;
  text: string;
  captcha: boolean;
  loginWall: boolean;
  cards: GenericCard[];
  dom: { nodes: number; links: number; images: number; scripts: number; iframes: number; bytes: number };
  timing: { ttfb?: number; domContentLoaded?: number; load?: number; transferSize?: number; resources: number; longTasks?: number };
};

export function genericProbeInPage(maxCards: number): GenericProbe {
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : undefined) || undefined;
  const abs = (u: unknown) => {
    const s = clean(Array.isArray(u) ? u[0] : typeof u === "object" && u ? (u as { url?: string }).url : u);
    if (!s) return undefined;
    try {
      return new URL(s, location.href).href;
    } catch {
      return undefined;
    }
  };
  const cards: GenericCard[] = [];
  const seen = new Set<string>();
  const add = (c: GenericCard) => {
    if (!c.title || c.title.length < 3 || cards.length >= maxCards) return;
    const key = (c.url ?? "") + "|" + c.title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ ...c, title: c.title.slice(0, 300) });
  };

  // 1. JSON-LD
  const fromLd = (node: any, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((n) => fromLd(n, depth + 1));
    const type = ([] as unknown[]).concat(node["@type"] ?? []).map(String);
    if (type.includes("Product")) {
      const offer = ([] as any[]).concat(node.offers ?? [])[0] ?? {};
      const agg = node.aggregateRating ?? {};
      add({
        title: clean(node.name) ?? "",
        url: abs(node.url ?? offer.url),
        price: clean(String(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? "")),
        currency: clean(offer.priceCurrency ?? offer.priceSpecification?.priceCurrency),
        image: abs(node.image),
        rating: agg.ratingValue != null ? String(agg.ratingValue) : undefined,
        reviews: agg.reviewCount != null ? String(agg.reviewCount) : agg.ratingCount != null ? String(agg.ratingCount) : undefined,
        source: "jsonld",
      });
    }
    for (const k of ["@graph", "itemListElement", "item", "itemOffered", "mainEntity", "hasPart", "offers"]) if (node[k]) fromLd(node[k], depth + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      fromLd(JSON.parse(s.textContent ?? ""), 0);
    } catch {
      /* a store's broken JSON-LD is not our problem */
    }
  }

  // 2. microdata
  for (const el of Array.from(document.querySelectorAll('[itemtype*="schema.org/Product" i]')).slice(0, maxCards)) {
    const prop = (p: string) => {
      const e = el.querySelector(`[itemprop="${p}"]`);
      return e ? clean(e.getAttribute("content") ?? (e as HTMLAnchorElement).href ?? (e as HTMLImageElement).src ?? e.textContent) : undefined;
    };
    add({ title: prop("name") ?? "", url: abs(prop("url") ?? el.querySelector("a[href]")?.getAttribute("href")), price: prop("price"), currency: prop("priceCurrency"), image: abs(prop("image")), source: "microdata" });
  }

  // 3. heuristic: the smallest box around a link that has an image and a money-looking text
  const MONEY = /(R\$|US\$|\$|€|£|MX\$|COP|CLP|S\/|ARS|USD|EUR|GBP)\s?\d|\d[\d.,]*\s?(€|EUR|USD)/;
  if (cards.length < maxCards) {
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      if (cards.length >= maxCards) break;
      if (!/^https?:/.test(a.href) || a.closest("header, nav, footer")) continue;
      let box: Element | null = a;
      for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
        const text = (box as HTMLElement).innerText ?? "";
        if (text.length > 600) break;
        const img = box.querySelector("img");
        const money = text.match(MONEY);
        if (img && money) {
          const priceLine = text.split("\n").find((l) => MONEY.test(l));
          const title = clean(a.getAttribute("title")) ?? clean(img.getAttribute("alt")) ?? clean(text.split("\n").find((l) => l.trim().length > 8 && !MONEY.test(l)));
          add({ title: title ?? "", url: a.href, price: clean(priceLine), image: abs(img.currentSrc || img.src || img.getAttribute("data-src")), source: "heuristic" });
          break;
        }
      }
    }
  }

  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const html = document.documentElement.outerHTML;
  const text = (document.body?.innerText ?? "").toLowerCase();
  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || "",
    text: text.slice(0, 4000),
    captcha: !!document.querySelector('iframe[src*="captcha" i], iframe[src*="challenge" i], #challenge-form, .g-recaptcha, .h-captcha, [id*="px-captcha"]'),
    loginWall: !!document.querySelector('input[type="password"]') && cards.length === 0,
    cards,
    dom: {
      nodes: document.getElementsByTagName("*").length,
      links: document.links.length,
      images: document.images.length,
      scripts: document.scripts.length,
      iframes: document.getElementsByTagName("iframe").length,
      bytes: html.length,
    },
    timing: {
      ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : undefined,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : undefined,
      load: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd - nav.startTime) : undefined,
      transferSize: nav?.transferSize,
      resources: performance.getEntriesByType("resource").length,
      longTasks: (window as any).__tccLongTasks,
    },
  };
}

/** "R$ 1.299,90", "$1,299.90", "1.299,90 €", "12.99" → 1299.9 / 12.99; currency from the symbol when present. */
export function parseMoney(text?: string, currencyHint?: string): { value?: number; currency?: string } {
  if (!text) return { currency: currencyHint };
  const sym = text.match(/R\$|US\$|MX\$|S\/|€|£|\$|\b(USD|EUR|GBP|BRL|MXN|ARS|CLP|COP|PEN)\b/i)?.[0];
  const map: Record<string, string> = { "R$": "BRL", "US$": "USD", "MX$": "MXN", "S/": "PEN", "€": "EUR", "£": "GBP", $: "USD" };
  const currency = currencyHint ?? (sym ? (map[sym] ?? sym.toUpperCase()) : undefined);
  const m = text.replace(/\s/g, "").match(/\d[\d.,]*/);
  if (!m) return { currency };
  let n = m[0].replace(/[.,]$/, "");
  const lastDot = n.lastIndexOf(".");
  const lastComma = n.lastIndexOf(",");
  const dec = Math.max(lastDot, lastComma);
  // a separator followed by exactly 1–2 digits at the end is the decimal one; 3 digits means thousands
  if (dec >= 0 && n.length - dec - 1 <= 2) n = n.slice(0, dec).replace(/[.,]/g, "") + "." + n.slice(dec + 1);
  else n = n.replace(/[.,]/g, "");
  const value = Number(n);
  return { value: Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined, currency };
}
