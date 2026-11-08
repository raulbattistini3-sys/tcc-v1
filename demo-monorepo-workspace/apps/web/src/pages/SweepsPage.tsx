import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ui from "../ui.module.css";
import { api } from "../api";
import { fmtInt, fmtMs, fmtWhen } from "../format";
import { QueryState } from "../components/QueryState";

export function SweepsPage() {
  const runs = useQuery({ queryKey: ["sweeps"], queryFn: api.sweeps });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["sweep", selected], queryFn: () => api.sweep(selected!), enabled: selected !== null });

  return (
    <>
      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Execuções</h2>
        <QueryState isLoading={runs.isLoading} error={runs.error} empty={runs.data?.length === 0} emptyText="Nenhuma varredura ainda. O harness e o demo enviam para POST /sweeps." />
        {runs.data && runs.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Origem</th>
                  <th>App</th>
                  <th>Framework</th>
                  <th>Condição</th>
                  <th>Estratégia</th>
                  <th>Transporte</th>
                  <th className={ui.num}>CPU ×</th>
                  <th className={ui.num}>Linhas</th>
                  <th className={ui.num}>Resultados</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className={ui.row} aria-selected={r.id === selected} onClick={() => setSelected(r.id)}>
                    <td>{fmtWhen(r.createdAt)}</td>
                    <td>{r.source}</td>
                    <td>{r.app}</td>
                    <td>{r.framework ?? "—"}</td>
                    <td>{r.condition ?? "—"}</td>
                    <td>{r.strategy ?? "várias"}</td>
                    <td>{r.transport ?? "—"}</td>
                    <td className={ui.num}>{r.throttling}</td>
                    <td className={ui.num}>{fmtInt(r.datasetRows)}</td>
                    <td className={ui.num}>{fmtInt(r.results)}</td>
                    <td className={ui.wrap}>{r.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className={ui.panel}>
          <h2 className={ui.panelTitle}>Por célula: estratégia × alvo × tamanho × consulta × frio</h2>
          <p className={ui.muted}>
            p50/p95 do tempo até o resultado, bloqueio da main thread e tempo até a pintura. "Erro da previsão" é a média de |previsto − medido| para o alvo
            escolhido.
          </p>
          <QueryState isLoading={detail.isLoading} error={detail.error} empty={detail.data?.cells.length === 0} emptyText="Execução sem resultados." />
          {detail.data && detail.data.cells.length > 0 && (
            <div className={ui.scroll}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th className={ui.num}>Tamanho</th>
                    <th>Consulta</th>
                    <th>Estratégia</th>
                    <th>Alvo</th>
                    <th>Frio</th>
                    <th className={ui.num}>n</th>
                    <th className={ui.num}>p50</th>
                    <th className={ui.num}>p95</th>
                    <th className={ui.num}>Bloqueio p50</th>
                    <th className={ui.num}>Pintura p50</th>
                    <th className={ui.num}>Erro da previsão</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.cells.map((c, i) => (
                    <tr key={i}>
                      <td className={ui.num}>{fmtInt(c.size)}</td>
                      <td>{c.queryKind ?? "—"}</td>
                      <td>{c.strategy ?? "—"}</td>
                      <td>{c.target}</td>
                      <td>{c.cold == null ? "—" : c.cold ? "sim" : "não"}</td>
                      <td className={ui.num}>{c.n}</td>
                      <td className={ui.num}>{fmtMs(c.p50Ms)}</td>
                      <td className={ui.num}>{fmtMs(c.p95Ms)}</td>
                      <td className={ui.num}>{fmtMs(c.p50BlockedMs)}</td>
                      <td className={ui.num}>{fmtMs(c.p50PaintMs)}</td>
                      <td className={ui.num}>{fmtMs(c.predErrorMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
