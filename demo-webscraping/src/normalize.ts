import type { ListingInput } from "@tcc/contracts";
import type { PageProbe, RawCard } from "./extract.js";
import type { SiteConfig } from "./sites/index.js";

// Strings from the page → listing records. Brazilian formats: "R$ 1.299,90", "4,7", "(1.234)", "12x R$ 99,90".

/** "R$ 1.299,90" → 1299.9; "1.299" with cents "90" → 1299.9; undefined when there's no number. */
export function parsePrice(text?: string, cents?: string): number | undefined {
  if (!text) return undefined;
  const m = text.replace(/\s/g, "").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!m) return undefined;
  const whole = Number(m[1]!.replace(/\./g, ""));
  const fromCents = cents?.match(/\d{1,2}/)?.[0];
  const frac = m[2] ?? fromCents;
  const value = frac ? whole + Number(frac.padEnd(2, "0")) / 100 : whole;
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

/** "4,7" or "4.7" → 4.7, only between 0 and 5. */
export function parseRating(text?: string): number | undefined {
  const m = text?.match(/(\d)(?:[.,](\d))?/);
  if (!m) return undefined;
  const v = Number(`${m[1]}.${m[2] ?? 0}`);
  return v >= 0 && v <= 5 ? v : undefined;
}

/** "(1.234)", "1234 avaliações", "+10mil" → 1234 / 10000. */
export function parseCount(text?: string): number | undefined {
  if (!text) return undefined;
  const mil = text.match(/(\d+(?:[.,]\d+)?)\s*mil/i);
  if (mil) return Math.round(Number(mil[1]!.replace(",", ".")) * 1000);
  const m = text.match(/\d{1,3}(?:\.\d{3})+|\d+/);
  return m ? Number(m[0].replace(/\./g, "")) : undefined;
}

export function toListing(cfg: SiteConfig, raw: RawCard, page: number, position: number): ListingInput | null {
  const title = raw.title?.slice(0, 1000);
  if (!title) return null;
  const id = raw.url?.match(new RegExp(cfg.externalId, "i"))?.[1];
  const shipping = raw.shipping?.toLowerCase();
  return {
    externalId: id,
    title,
    url: raw.url,
    price: parsePrice(raw.price, raw.priceCents),
    originalPrice: parsePrice(raw.originalPrice),
    installments: raw.installments,
    rating: parseRating(raw.rating),
    reviewCount: parseCount(raw.reviews),
    seller: raw.seller,
    freeShipping: shipping ? /gr[aá]tis|free/.test(shipping) : undefined,
    imageUrl: raw.image?.startsWith("data:") ? undefined : raw.image,
    page,
    position,
    raw: { ...raw },
  };
}

const BLOCK_TEXT = [
  "não é um robô",
  "nao e um robo",
  "verifique que você é humano",
  "confirme que você é humano",
  "are you a robot",
  "verify you are human",
  "unusual traffic",
  "tráfego incomum",
  "access denied",
  "acesso negado",
  "slide to verify",
  "deslize para verificar",
  "please enable cookies",
];

/** Why a page shouldn't be read any further, or null when it can be. */
export function blockReason(p: PageProbe): string | null {
  if (p.captcha) return "captcha on the page";
  const hit = BLOCK_TEXT.find((t) => p.text.includes(t));
  if (hit) return `page says "${hit}"`;
  // Magalu, Nov 8, 2026: "Magazine Luiza | Não é possível acessar a página"
  if (/^(403|429|access denied|forbidden)|não é possível acessar|acesso bloqueado|page not available/i.test(p.title.trim())) return `page title "${p.title}"`;
  if (p.loginWall && p.cards.length === 0) return "login required before listing";
  // login pages and bot checks the store redirects to (Mercado Livre: /gz/account-verification,
  // Shopee: /verify/traffic/error)
  if (/\/(login|signin|account\/login|buyer\/login|account-verification|verification|verify|captcha|challenge|punish)/i.test(new URL(p.url).pathname))
    return `redirected to ${new URL(p.url).pathname}`;
  return null;
}
