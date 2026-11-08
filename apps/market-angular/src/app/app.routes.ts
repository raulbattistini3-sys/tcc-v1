import type { Routes } from "@angular/router";
import { HomePageComponent } from "./home/home-page.component";
import { ListingPageComponent } from "./listing/listing-page.component";
import { ProductPageComponent } from "./pages/product-page.component";
import { CartPageComponent } from "./pages/cart-page.component";
import { NotFoundComponent } from "./pages/not-found.component";

// Eager, like market-react's router: no lazy chunk to fetch in the middle of a measured navigation.
export const routes: Routes = [
  { path: "", component: HomePageComponent },
  { path: "lista", component: ListingPageComponent },
  { path: "produto/:index", component: ProductPageComponent },
  { path: "carrinho", component: CartPageComponent },
  { path: "**", component: NotFoundComponent },
];
