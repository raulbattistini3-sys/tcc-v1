const ms1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("pt-BR");
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" });

export const fmtMs = (v: number | null | undefined) => (v == null ? "—" : `${ms1.format(v)} ms`);
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
export const fmtMoney = (v: number | null | undefined, currency = "BRL") =>
  v == null ? "—" : currency === "BRL" ? brl.format(v) : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
export const fmtWhen = (iso: string) => when.format(new Date(iso));
