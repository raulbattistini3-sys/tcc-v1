import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SITES, type Site } from "@tcc/contracts";
import ui from "../ui.module.css";
import { api } from "../api";
import { fmtInt, fmtMoney, fmtWhen } from "../format";
import { QueryState } from "../components/QueryState";

const SITE_LABEL: Record<Site, string> = {
  mercadolivre: "Mercado Livre",
  magalu: "Magalu",
  shopee: "Shopee",
  shein: "Shein",
  aliexpress: "AliExpress",
};

const STATUS_CLASS: Record<string, string | undefined> = { ok: ui.ok, partial: ui.warn, blocked: ui.bad, disallowed: ui.bad, error: ui.bad };

export function ListingsPage() {
  const [site, setSite] = useState<Site | "">("");
  const [runId, setRunId] = useState("");
  const runs = useQuery({ queryKey: ["scrapes", site], queryFn: () => api.scrapes(site) });
  const listings = useQuery({ queryKey: ["listings", site, runId], queryFn: () => api.listings(site, runId) });

  return (
    <>
      <div className={ui.toolbar}>
        <label>
          Loja{" "}
          <select
            className={ui.select}
            value={site}
            onChange={(e) => {
              setSite(e.target.value as Site | "");
              setRunId("");
            }}
          >
            <option value="">Todas</option>
            {SITES.map((s) => (
              <option key={s} value={s}>
                {SITE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {runId && (
          <button className={ui.tab} onClick={() => setRunId("")}>
            Todas as coletas
          </button>
        )}
      </div>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Coletas</h2>
        <QueryState isLoading={runs.isLoading} error={runs.error} empty={runs.data?.length === 0} emptyText="Nenhuma coleta. Rode demo-webscraping com --post." />
        {runs.data && runs.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Loja</th>
                  <th>Status</th>
                  <th className={ui.num}>Páginas</th>
                  <th className={ui.num}>Anúncios</th>
                  <th className={ui.num}>Intervalo</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className={ui.row} aria-selected={r.id === runId} onClick={() => setRunId(r.id)}>
                    <td>{fmtWhen(r.createdAt)}</td>
                    <td>{SITE_LABEL[r.site] ?? r.site}</td>
                    <td>
                      <span className={`${ui.badge} ${STATUS_CLASS[r.status] ?? ""}`}>{r.status}</span>
                    </td>
                    <td className={ui.num}>
                      {r.pagesFetched}/{r.pagesRequested}
                    </td>
                    <td className={ui.num}>{fmtInt(r.listings)}</td>
                    <td className={ui.num}>{(r.delayMs / 1000).toFixed(1)} s</td>
                    <td className={ui.wrap}>{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Anúncios {listings.data ? `(${fmtInt(listings.data.length)})` : ""}</h2>
        <QueryState isLoading={listings.isLoading} error={listings.error} empty={listings.data?.length === 0} emptyText="Nenhum anúncio para este filtro." />
        {listings.data && listings.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th />
                  <th>Título</th>
                  <th>Loja</th>
                  <th className={ui.num}>Preço</th>
                  <th className={ui.num}>De</th>
                  <th>Parcelas</th>
                  <th className={ui.num}>Nota</th>
                  <th className={ui.num}>Avaliações</th>
                  <th>Frete grátis</th>
                  <th className={ui.num}>Pág./pos.</th>
                </tr>
              </thead>
              <tbody>
                {listings.data.map((l) => (
                  <tr key={l.id}>
                    <td>{l.imageUrl ? <img className={ui.thumb} src={l.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}</td>
                    <td className={ui.wrap}>
                      {l.url ? (
                        <a href={l.url} target="_blank" rel="noreferrer noopener">
                          {l.title}
                        </a>
                      ) : (
                        l.title
                      )}
                    </td>
                    <td>{SITE_LABEL[l.site] ?? l.site}</td>
                    <td className={ui.num}>{fmtMoney(l.price, l.currency)}</td>
                    <td className={ui.num}>{fmtMoney(l.originalPrice, l.currency)}</td>
                    <td className={ui.wrap}>{l.installments ?? ""}</td>
                    <td className={ui.num}>{l.rating ?? "—"}</td>
                    <td className={ui.num}>{fmtInt(l.reviewCount)}</td>
                    <td>{l.freeShipping == null ? "—" : l.freeShipping ? "sim" : "não"}</td>
                    <td className={ui.num}>
                      {l.page}/{l.position}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
