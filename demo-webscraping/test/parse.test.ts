import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowed, parseRobots } from "../src/robots.js";
import { blockReason, parseCount, parsePrice, parseRating, toListing } from "../src/normalize.js";
import { SITE_CONFIGS } from "../src/sites/index.js";
import type { PageProbe } from "../src/extract.js";

test("prices in Brazilian format", () => {
  assert.equal(parsePrice("R$ 1.299,90"), 1299.9);
  assert.equal(parsePrice("R$1.299"), 1299);
  assert.equal(parsePrice("1.299", "90"), 1299.9);
  assert.equal(parsePrice("R$ 19", "9"), 19.9);
  assert.equal(parsePrice("R$ 0,99"), 0.99);
  assert.equal(parsePrice("R$ 12.345.678,01"), 12345678.01);
  assert.equal(parsePrice("12x R$ 99,90 sem juros"), 12, "the first number wins: installment counts are not prices, keep installments out of the price field");
  assert.equal(parsePrice("grátis"), undefined);
  assert.equal(parsePrice(undefined), undefined);
});

test("ratings and counts", () => {
  assert.equal(parseRating("4,7"), 4.7);
  assert.equal(parseRating("4.5 de 5"), 4.5);
  assert.equal(parseRating("Novo"), undefined);
  assert.equal(parseCount("(1.234)"), 1234);
  assert.equal(parseCount("+10mil vendidos"), 10000);
  assert.equal(parseCount("2,5 mil"), 2500);
  assert.equal(parseCount("sem avaliações"), undefined);
});

test("a card becomes a listing with the store's product id", () => {
  const l = toListing(
    SITE_CONFIGS.mercadolivre,
    {
      url: "https://www.mercadolivre.com.br/celular-x/p/MLB12345678#polycard",
      title: "Celular X 128 GB",
      price: "1.299",
      priceCents: "90",
      originalPrice: "R$ 1.599",
      rating: "4,8",
      reviews: "(321)",
      shipping: "Frete grátis",
      image: "data:image/gif;base64,R0lGOD",
    },
    2,
    5,
  );
  assert.ok(l);
  assert.equal(l.externalId, "MLB12345678");
  assert.equal(l.price, 1299.9);
  assert.equal(l.originalPrice, 1599);
  assert.equal(l.rating, 4.8);
  assert.equal(l.reviewCount, 321);
  assert.equal(l.freeShipping, true);
  assert.equal(l.imageUrl, undefined, "placeholder data: images are dropped");
  assert.deepEqual([l.page, l.position], [2, 5]);
  assert.equal(toListing(SITE_CONFIGS.mercadolivre, { url: "https://x" }, 1, 1), null, "no title, no listing");
});

test("robots.txt: our group over *, longest rule wins, allow wins ties, wildcards and $", () => {
  const txt = `
User-agent: *
Disallow: /search
Allow: /search/ok$
Disallow: /*.json$
Crawl-delay: 2

User-agent: tcc-research-bot
Disallow: /private
`;
  const star = { ...parseRobots(txt, "otherbot"), status: "ok" as const };
  assert.equal(star.crawlDelaySec, 2);
  assert.equal(isAllowed(star, "/"), true);
  assert.equal(isAllowed(star, "/search?q=x"), false);
  assert.equal(isAllowed(star, "/search/ok"), true);
  assert.equal(isAllowed(star, "/search/ok/more"), false);
  assert.equal(isAllowed(star, "/data/x.json"), false);
  assert.equal(isAllowed(star, "/data/x.json?y"), true);

  const mine = { ...parseRobots(txt, "tcc-research-bot/0.1"), status: "ok" as const };
  assert.equal(isAllowed(mine, "/search"), true, "our own group replaces *");
  assert.equal(isAllowed(mine, "/private/x"), false);

  assert.equal(isAllowed({ rules: [], status: "unreachable" }, "/"), false, "unreachable robots.txt: assume disallowed");
  assert.equal(isAllowed({ rules: [], status: "unavailable" }, "/"), true, "4xx robots.txt: allowed (RFC 9309)");
});

test("block detection", () => {
  const page = (o: Partial<PageProbe>): PageProbe => ({ url: "https://x.com/list", title: "Celulares", text: "", captcha: false, loginWall: false, cards: [], ...o });
  assert.equal(blockReason(page({ cards: [{ title: "a" }] })), null);
  assert.match(blockReason(page({ captcha: true }))!, /captcha/);
  assert.match(blockReason(page({ text: "por favor, confirme que você é humano" }))!, /humano/);
  assert.match(blockReason(page({ title: "403 Forbidden" }))!, /403/);
  assert.match(blockReason(page({ loginWall: true }))!, /login/);
  assert.equal(blockReason(page({ loginWall: true, cards: [{ title: "a" }] })), null, "a login link next to products isn't a wall");
  assert.match(blockReason(page({ url: "https://shopee.com.br/buyer/login?next=x" }))!, /buyer\/login/);
  // what Mercado Livre did on Nov 8, 2026 to a headless Chrome labeled tcc-research-bot
  assert.match(blockReason(page({ url: "https://www.mercadolivre.com.br/gz/account-verification?go=x&tid=y", title: "Mercado Libre" }))!, /account-verification/);
  // Shopee and Magalu, same day
  assert.match(blockReason(page({ url: "https://shopee.com.br/verify/traffic/error?home_url=x", title: "Shopee Brasil" }))!, /verify/);
  assert.match(blockReason(page({ title: "Magazine Luiza | Não é possível acessar a página" }))!, /acessar/);
});
