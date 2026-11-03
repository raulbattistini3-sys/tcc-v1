import { useState } from "react";
import FormLabel from "@mui/material/FormLabel";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import { formatPrice } from "@shared/catalog.js";
import { useCatalogStore } from "../../stores/catalog.store.js";

const MAX = 5000;

// The slider moves locally and commits once on release (onChangeCommitted),
// so a drag runs one scheduler query, not sixty. Angular does the same with (valueChange) on the thumb end.
export function PriceFilter() {
  const setPrice = useCatalogStore((s) => s.setPrice);
  const [range, setRange] = useState(/** @type {number[]} */ ([0, MAX]));
  return (
    <Stack spacing={1}>
      <FormLabel>
        Preço: {formatPrice(range[0])} – {range[1] >= MAX ? "sem limite" : formatPrice(range[1])}
      </FormLabel>
      <Slider
        value={range}
        min={0}
        max={MAX}
        step={50}
        onChange={(_, v) => setRange(/** @type {number[]} */ (v))}
        onChangeCommitted={(_, v) => {
          const [lo, hi] = /** @type {number[]} */ (v);
          setPrice([lo > 0 ? lo : null, hi < MAX ? hi : null]);
        }}
        getAriaLabel={(i) => (i === 0 ? "Preço mínimo" : "Preço máximo")}
      />
    </Stack>
  );
}
