const ms1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("pt-BR");
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

export const fmtMs = (v: number | null | undefined) => (v == null ? "—" : `${ms1.format(v)} ms`);
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
export const fmtMoney = (v: number | null | undefined, currency = "BRL") =>
  v == null ? "—" : currency === "BRL" ? brl.format(v) : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
// raw SQL rows carry Postgres' text form ("2026-11-15 04:03:56.683-03"), which not every browser parses
const toDate = (v: string) => new Date(/^\d{4}-\d\d-\d\d /.test(v) ? v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00") : v);
export const fmtWhen = (iso: string) => when.format(toDate(iso));

const mb = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const fmtBytes = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1 << 20 ? `${mb.format(v / (1 << 20))} MB` : v >= 1024 ? `${mb.format(v / 1024)} KB` : `${int.format(v)} B`;
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${mb.format(v * 100)}%`);
/** a duration that can be long: ms, then s, min, h */
export const fmtSpan = (v: number | null | undefined) =>
  v == null ? "—" : v < 1000 ? `${ms1.format(v)} ms` : v < 60_000 ? `${mb.format(v / 1000)} s` : v < 3_600_000 ? `${mb.format(v / 60_000)} min` : `${mb.format(v / 3_600_000)} h`;
