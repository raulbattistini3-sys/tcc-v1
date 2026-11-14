import type { Site } from "@tcc/contracts";

// One config per store: where its listing pages are and how to read a product card. Stores change
// their markup often; when a run comes back "ok" with 0 listings, the card selectors here are the first
// thing to update. Every field selector is optional: the extractor falls back to the card's first
// product link, image and "R$ …" text.

export type SiteConfig = {
  id: Site;
  label: string;
  /** a category listing (not a search), page 1 */
  startUrl: string;
  /** listing page n (1-based) */
  pageUrl: (start: string, n: number) => string;
  /** a product link on the page, as a regex source; also how a card is found when `card` matches nothing */
  productLink: string;
  /** the product id inside a product URL (first capture group) */
  externalId: string;
  card: string;
  title?: string;
  price?: string;
  /** stores that split R$ 1.299 and ,99 into two elements */
  priceCents?: string;
  originalPrice?: string;
  installments?: string;
  rating?: string;
  reviews?: string;
  seller?: string;
  shipping?: string;
  image?: string;
  /** shown on pages that ask for a login before listing anything */
  loginWall?: string;
};

const withParam = (key: string) => (start: string, n: number) => {
  const u = new URL(start);
  if (n > 1) u.searchParams.set(key, String(n));
  return u.toString();
};

export const SITE_CONFIGS: Record<Site, SiteConfig> = {
  mercadolivre: {
    id: "mercadolivre",
    label: "Mercado Livre",
    startUrl: "https://lista.mercadolivre.com.br/celulares-telefones/celulares-smartphones/",
    // 48 per page: page n starts at item 48·(n−1)+1
    pageUrl: (start, n) => (n === 1 ? start : `${start.replace(/\/$/, "")}/_Desde_${48 * (n - 1) + 1}_NoIndex_True`),
    productLink: "mercadolivre\\.com\\.br/.*(MLB-?\\d+)",
    externalId: "(MLB-?\\d+)",
    card: "li.ui-search-layout__item, .poly-card",
    title: ".poly-component__title, .ui-search-item__title",
    price: ".poly-price__current .andes-money-amount__fraction, .ui-search-price__second-line .andes-money-amount__fraction",
    priceCents: ".poly-price__current .andes-money-amount__cents, .ui-search-price__second-line .andes-money-amount__cents",
    originalPrice: "s.andes-money-amount--previous, .andes-money-amount--previous",
    installments: ".poly-price__installments, .ui-search-installments",
    rating: ".poly-reviews__rating, .ui-search-reviews__rating-number",
    reviews: ".poly-reviews__total, .ui-search-reviews__amount",
    seller: ".poly-component__seller, .ui-search-official-store-label",
    shipping: ".poly-component__shipping, .ui-search-item__shipping",
    image: "img.poly-component__picture, img.ui-search-result-image__element",
  },
  magalu: {
    id: "magalu",
    label: "Magalu",
    startUrl: "https://www.magazineluiza.com.br/celulares-e-smartphones/l/te/",
    pageUrl: withParam("page"),
    productLink: "magazineluiza\\.com\\.br/.+/p/([a-z0-9]+)/",
    externalId: "/p/([a-z0-9]+)/",
    card: '[data-testid="product-card-container"]',
    title: '[data-testid="product-title"]',
    price: '[data-testid="price-value"]',
    originalPrice: '[data-testid="price-original"]',
    installments: '[data-testid="installment"]',
    rating: '[data-testid="review"]',
    image: '[data-testid="image"]',
  },
  shopee: {
    id: "shopee",
    label: "Shopee",
    startUrl: "https://shopee.com.br/Celulares-e-Dispositivos-cat.11059983",
    // 0-based ?page=
    pageUrl: (start, n) => {
      const u = new URL(start);
      if (n > 1) u.searchParams.set("page", String(n - 1));
      return u.toString();
    },
    productLink: "shopee\\.com\\.br/.+-i\\.(\\d+\\.\\d+)",
    externalId: "-i\\.(\\d+\\.\\d+)",
    card: 'li.shopee-search-item-result__item, [data-sqe="item"]',
    title: '[data-sqe="name"]',
    loginWall: 'form input[type="password"], [href*="/buyer/login"]',
  },
  shein: {
    id: "shein",
    label: "Shein",
    startUrl: "https://br.shein.com/Women-Dresses-c-1727.html",
    pageUrl: withParam("page"),
    productLink: "shein\\.com/.+-p-(\\d+)",
    externalId: "-p-(\\d+)",
    card: "section.product-card, .product-list__item",
    title: ".goods-title-link, .product-card__goods-title-container a",
    price: ".product-item__camecase-wrap, .normal-price-ctn__sale-price",
    originalPrice: ".product-card__price-retail, del",
    image: "img.crop-image-container__img, img",
  },
  aliexpress: {
    id: "aliexpress",
    label: "AliExpress",
    startUrl: "https://pt.aliexpress.com/category/509/cellphones-telecommunications.html",
    pageUrl: withParam("page"),
    productLink: "aliexpress\\.[a-z.]+/item/(\\d+)\\.html",
    externalId: "/item/(\\d+)\\.html",
    // its class names are hashed per build: cards are found through their product links
    card: '[class*="search-item-card"], a.search-card-item',
    title: "h3, [title]",
  },
};

export const SITE_LIST = Object.values(SITE_CONFIGS);
