import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import { categoryLabel } from "@shared/market.js";
import { productImage } from "@shared/product-image.js";
import { useCatalog } from "../../catalog/CatalogContext";
import { useOpenListing } from "../../hooks/market";
import css from "./home.module.scss";

export function CategoryTiles() {
  const { categories } = useCatalog();
  const open = useOpenListing();
  return (
    <section>
      <h2 className={css.title}>Categorias</h2>
      <div className={css.tiles}>
        {categories.map((c) => (
          <Card key={c} variant="outlined">
            <CardActionArea className={css.tile} onClick={() => open({ categories: [c] })}>
              <img className={css.tileImage} src={productImage(c, 0)} alt="" width={72} height={72} />
              {categoryLabel(c)}
            </CardActionArea>
          </Card>
        ))}
      </div>
    </section>
  );
}
