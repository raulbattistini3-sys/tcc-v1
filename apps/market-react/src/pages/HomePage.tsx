import { useMemo } from "react";
import { DEALS_SPEC, NEWEST_SPEC } from "@shared/market.js";
import { useCatalog, useConditions } from "../catalog/CatalogContext";
import { useChannelProducts } from "../hooks/market";
import { useSessionStore } from "../stores/session.store";
import { HeroCarousel } from "../components/home/HeroCarousel";
import { CategoryTiles } from "../components/home/CategoryTiles";
import { ProductRail } from "../components/product/ProductRail";

const RAIL = 12;

/**
 * The page the main thread has to paint and keep interactive while the worker answers the rails'
 * queries: hero, tiles and three rails of cards with images.
 */
export function HomePage() {
  const catalog = useCatalog();
  const { carousel } = useConditions();
  const signedIn = useSessionStore((s) => s.user !== null);
  const deals = useChannelProducts(DEALS_SPEC, "home:deals", RAIL);
  const newest = useChannelProducts(NEWEST_SPEC, "home:newest", RAIL);
  const recommended = useMemo(() => catalog.recommendations(RAIL), [catalog]);
  return (
    <>
      <HeroCarousel />
      <ProductRail title="Ofertas do dia" products={deals} testId="rail-deals" />
      {signedIn && <ProductRail title="Recomendados para você" products={recommended} autoplay={carousel} testId="rail-recommended" />}
      <CategoryTiles />
      <ProductRail title="Novidades" products={newest} testId="rail-newest" />
    </>
  );
}
