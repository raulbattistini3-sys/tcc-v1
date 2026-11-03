import { memo } from "react";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import AddShoppingCartIcon from "@mui/icons-material/AddShoppingCart";
import { formatPrice } from "@shared/catalog.js";
import { productImage } from "@shared/product-image.js";
import { useCartActions } from "../../hooks/useCart.js";
import { useSignedIn } from "../../hooks/useSession.js";

/** @typedef {import("@shared/catalog.js").Product} Product */

// memo: a product is a fresh object per page, so this only skips re-renders
// caused by parents (e.g. a cart change), the same as Angular's OnPush + track.
export const ProductCard = memo(function ProductCard(/** @type {{ product: Product }} */ { product }) {
  const { add } = useCartActions();
  const signedIn = useSignedIn();
  return (
    <Card variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
      <CardMedia component="img" height="120" image={productImage(product.categoria, product.index)} alt="" loading="lazy" />
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {product.categoria}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 500 }} gutterBottom>
          {product.name}
        </Typography>
        <Typography variant="h6">{formatPrice(product.price)}</Typography>
        <Typography variant="caption" color={product.stock > 0 ? "text.secondary" : "error"}>
          {product.stock > 0 ? `${product.stock} em estoque` : "Esgotado"}
        </Typography>
      </CardContent>
      {signedIn && (
        <CardActions>
          <Button size="small" startIcon={<AddShoppingCartIcon />} disabled={product.stock <= 0} onClick={() => add(product)}>
            Adicionar
          </Button>
        </CardActions>
      )}
    </Card>
  );
});
