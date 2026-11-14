import type { SiteConfig } from "./sites/index.js";

// Runs inside the page (Selenium executeScript): it is serialized, so it may use nothing from this
// module's scope. It only collects strings; parsing happens in Node (normalize.ts), where it's tested.

export type RawCard = {
  url?: string;
  title?: string;
  price?: string;
  priceCents?: string;
  originalPrice?: string;
  installments?: string;
  rating?: string;
  reviews?: string;
  seller?: string;
  shipping?: string;
  image?: string;
};

export type PageProbe = {
  url: string;
  title: string;
  text: string;
  captcha: boolean;
  loginWall: boolean;
  cards: RawCard[];
};

export function extractInPage(cfg: Omit<SiteConfig, "pageUrl">): PageProbe {
  const clean = (s: string | null | undefined) => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t || undefined;
  };
  const abs = (u: string | null | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u, location.href).href;
    } catch {
      return undefined;
    }
  };
  const link = new RegExp(cfg.productLink, "i");
  const productAnchor = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => link.test(a.href));

  let cards = cfg.card ? Array.from(document.querySelectorAll<HTMLElement>(cfg.card)) : [];
  // nested matches (a .poly-card inside an li that also matched): keep the outermost
  cards = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));
  if (cards.length === 0) {
    // fallback: the nearest container of each distinct product link
    const seen = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      if (!link.test(a.href) || seen.has(a.href)) continue;
      seen.add(a.href);
      cards.push((a.closest("li, article, section, [class*='card'], [class*='item']") as HTMLElement | null) ?? a);
    }
  }

  const field = (card: Element, sel?: string) => (sel ? clean(card.querySelector(sel)?.textContent) : undefined);
  const out: RawCard[] = cards.slice(0, 120).map((card) => {
    const a = (card.matches("a[href]") && link.test((card as HTMLAnchorElement).href) ? (card as HTMLAnchorElement) : null) ?? productAnchor(card);
    const img = (cfg.image ? card.querySelector<HTMLImageElement>(cfg.image) : null) ?? card.querySelector<HTMLImageElement>("img");
    const imgEl = img && img.tagName === "IMG" ? img : img?.querySelector("img");
    const priceText = field(card, cfg.price) ?? clean(Array.from(card.querySelectorAll("*")).map((e) => e.childNodes.length === 1 ? e.textContent : "").find((t) => /R\$\s*\d/.test(t ?? "")));
    return {
      url: abs(a?.getAttribute("href")),
      title: field(card, cfg.title) ?? clean(a?.getAttribute("title")) ?? clean(imgEl?.getAttribute("alt")) ?? clean(a?.textContent),
      price: priceText,
      priceCents: field(card, cfg.priceCents),
      originalPrice: field(card, cfg.originalPrice),
      installments: field(card, cfg.installments),
      rating: field(card, cfg.rating),
      reviews: field(card, cfg.reviews),
      seller: field(card, cfg.seller),
      shipping: field(card, cfg.shipping),
      image: abs(imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || undefined),
    };
  });

  const text = (document.body?.innerText ?? "").slice(0, 4000).toLowerCase();
  const captcha = !!document.querySelector(
    "iframe[src*='captcha'], iframe[src*='challenge'], #captcha, [id*='captcha'], [class*='captcha'], .g-recaptcha, .h-captcha, #nc_1_wrapper, .baxia-dialog, #px-captcha",
  );
  return {
    url: location.href,
    title: document.title,
    text,
    captcha,
    loginWall: cfg.loginWall ? !!document.querySelector(cfg.loginWall) : false,
    cards: out,
  };
}
