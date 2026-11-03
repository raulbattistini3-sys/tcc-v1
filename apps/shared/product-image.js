// Product "photos": deterministic SVGs, one per category and shade. The grid
// gets real <img> decode and paint work without shipping image files.
// data: URIs pass `img-src 'self' data:` under the strict CSP.

/** @type {Map<string, string>} */
const cache = new Map();

/** @param {string} s */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** @param {string} categoria @param {number} index */
export function productImage(categoria, index) {
  const hue = hash(categoria) % 360;
  const shade = index % 6;
  const key = `${hue}:${shade}`;
  let uri = cache.get(key);
  if (!uri) {
    const l = 82 - shade * 6;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
      `<rect width="160" height="120" fill="hsl(${hue} 45% ${l}%)"/>` +
      `<circle cx="${40 + shade * 16}" cy="58" r="26" fill="hsl(${hue} 55% ${l - 22}%)"/>` +
      `<rect x="74" y="38" width="56" height="40" rx="6" fill="hsl(${(hue + 30) % 360} 50% ${l - 12}%)"/></svg>`;
    uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    cache.set(key, uri);
  }
  return uri;
}
