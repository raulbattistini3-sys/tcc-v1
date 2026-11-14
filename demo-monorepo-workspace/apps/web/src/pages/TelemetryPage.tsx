import { useQuery } from "@tanstack/react-query";
import ui from "../ui.module.css";
import { api } from "../api";
import { fmtInt, fmtWhen } from "../format";
import { QueryState } from "../components/QueryState";

export function TelemetryPage() {
  const stats = useQuery({ queryKey: ["ingest-stats"], queryFn: api.stats });
  const batches = useQuery({ queryKey: ["ingest-batches"], queryFn: api.batches });

  return (
    <>
      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Eventos por origem e tipo</h2>
        <QueryState isLoading={stats.isLoading} error={stats.error} empty={stats.data?.length === 0} emptyText="Nada recebido. Aponte o Collector URL da extensão para /ingest." />
        {stats.data && stats.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Tipo</th>
                  <th className={ui.num}>Eventos</th>
                  <th>Último</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.map((s) => (
                  <tr key={`${s.source}/${s.type}`}>
                    <td>{s.source}</td>
                    <td>{s.type}</td>
                    <td className={ui.num}>{fmtInt(s.events)}</td>
                    <td>{fmtWhen(s.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Últimos envios</h2>
        <QueryState isLoading={batches.isLoading} error={batches.error} empty={batches.data?.length === 0} emptyText="Nenhum envio." />
        {batches.data && batches.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Recebido</th>
                  <th>Tipo</th>
                  <th>Quem</th>
                  <th>Extensão</th>
                  <th className={ui.num}>Eventos</th>
                  <th className={ui.num}>Bytes</th>
                </tr>
              </thead>
              <tbody>
                {batches.data.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtWhen(b.receivedAt)}</td>
                    <td>{b.kind}</td>
                    <td className={ui.mono}>{b.label || b.installId?.slice(0, 8) || "—"}</td>
                    <td>{b.extVersion ?? "—"}</td>
                    <td className={ui.num}>{fmtInt(b.eventCount)}</td>
                    <td className={ui.num}>{fmtInt(b.bytes)}</td>
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
