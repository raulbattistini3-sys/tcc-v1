import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import ui from "../ui.module.css";
import { api, type HostSample, type Timeline } from "../api";
import { fmtBytes, fmtInt, fmtMs, fmtPct, fmtSpan, fmtWhen } from "../format";
import { QueryState } from "../components/QueryState";

// Three views of what the server receives:
//   Navegador  the extension's probe: each page load's network timeline, Web Vitals, and the first
//              request to each URL against the ones after it (Server-Timing splits network from API/DB)
//   Servidor   host telemetry from Node services: runtime (memory, GC), performance (event loop,
//              request and query durations) and lifecycle (boots, restarts, degraded)
//   Envios     the raw uploads and their sequence numbers (lost or repeated uploads)

type View = "browser" | "host" | "uploads";
const VIEWS: [View, string][] = [
  ["browser", "Navegador"],
  ["host", "Servidor"],
  ["uploads", "Envios"],
];

export function TelemetryPage() {
  const [view, setView] = useState<View>("browser");
  return (
    <>
      <div className={ui.subtabs} role="tablist">
        {VIEWS.map(([id, label]) => (
          <button key={id} role="tab" className={ui.tab} aria-selected={view === id} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
      {view === "browser" && <BrowserView />}
      {view === "host" && <HostView />}
      {view === "uploads" && <UploadsView />}
    </>
  );
}

// ─── Navegador ──────────────────────────────────────────────────────────────────────────────────────

// fixed mid-tone colors, readable on the light and the dark surface
const PHASES: { key: keyof Timeline; label: string; color: string }[] = [
  { key: "redirect", label: "Redirect", color: "#adb5bd" },
  { key: "dns", label: "DNS", color: "#20a4a4" },
  { key: "connect", label: "TCP+TLS", color: "#e8a33d" },
  { key: "queue", label: "Fila", color: "#9775fa" },
  { key: "ttfb", label: "TTFB", color: "#4c6ef5" },
  { key: "download", label: "Download", color: "#40c057" },
];

function Legend() {
  return (
    <div className={ui.legend}>
      {PHASES.map((p) => (
        <span key={p.key} style={{ "--c": p.color } as CSSProperties}>
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** the request's phases as one stacked bar, scaled against `scale` ms; TLS is shown inside TCP+TLS */
function TimelineBar({ t, scale }: { t: Timeline; scale: number }) {
  const title = PHASES.map((p) => `${p.label} ${fmtMs(Number(t[p.key] ?? 0))}`).join(" · ") + (t.tls ? ` (TLS ${fmtMs(t.tls)})` : "");
  return (
    <div className={ui.bar} title={title}>
      {PHASES.map((p) => {
        const v = Number(t[p.key] ?? 0);
        return v > 0 ? <div key={p.key} className={ui.seg} style={{ width: `${(100 * v) / scale}%`, background: p.color }} /> : null;
      })}
    </div>
  );
}

const path = (url: string | null) => {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return url;
  }
};

const VITAL_LIMITS: Record<string, [number, number]> = { FCP: [1800, 3000], LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25] };
const vitalClass = (name: string, v: number) => {
  const l = VITAL_LIMITS[name];
  return !l ? "" : v <= l[0] ? ui.ok : v <= l[1] ? ui.warn : ui.bad;
};
const fmtVital = (name: string, v: number) => (name === "CLS" ? v.toFixed(3) : fmtMs(v));

function BrowserView() {
  const loads = useQuery({ queryKey: ["ingest-navigation"], queryFn: api.navigation });
  const vitals = useQuery({ queryKey: ["ingest-vitals"], queryFn: api.vitals });
  const [initiator, setInitiator] = useState("fetch");
  const resources = useQuery({ queryKey: ["ingest-resources", initiator], queryFn: () => api.resources(initiator) });

  const pages = loads.data ?? [];
  const scale = Math.max(1, ...pages.map((l) => PHASES.reduce((s, p) => s + Number(l.data[p.key] ?? 0), 0)));
  const vitalNames = ["FCP", "LCP", "INP", "CLS"];
  const vitalPages = [...new Set((vitals.data ?? []).map((v) => v.page))];

  return (
    <>
      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Carregamentos de página</h2>
        <p className={ui.hint}>
          Cada navegação dividida em DNS, conexão (TCP, com TLS dentro dela em HTTPS), fila, TTFB (requestStart → responseStart) e download. Uma conexão reaproveitada tem
          DNS/TCP/TLS zero. "Desde a anterior" é o intervalo até a navegação anterior na mesma aba, e até o fim do carregamento dela.
        </p>
        <Legend />
        <QueryState isLoading={loads.isLoading} error={loads.error} empty={pages.length === 0} emptyText="Nenhum carregamento. A extensão 0.4+ envia eventos “page”." />
        {pages.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Página</th>
                  <th>Tipo</th>
                  <th>Linha do tempo</th>
                  <th className={ui.num}>TTFB</th>
                  <th className={ui.num}>App (servidor)</th>
                  <th className={ui.num}>DOMContentLoaded</th>
                  <th className={ui.num}>Load</th>
                  <th className={ui.num}>Desde a anterior</th>
                  <th className={ui.num}>Desde o load anterior</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((l, i) => (
                  <tr key={`${l.installId}-${l.tabId}-${l.navigatedAt}-${i}`}>
                    <td>{fmtWhen(l.navigatedAt)}</td>
                    <td className={ui.mono}>
                      {path(l.page)}
                      {l.firstForOrigin && <span className={`${ui.badge} ${ui.warn}`} title="primeira visita a esta origem nesta instalação"> 1ª</span>}
                    </td>
                    <td>{l.data.navType ?? "—"}</td>
                    <td>
                      <TimelineBar t={l.data} scale={scale} />
                    </td>
                    <td className={ui.num}>{fmtMs(l.data.ttfb)}</td>
                    <td className={ui.num}>{fmtMs(l.data.serverTiming?.app)}</td>
                    <td className={ui.num}>{fmtMs(l.data.domContentLoaded)}</td>
                    <td className={ui.num}>{fmtMs(l.data.load)}</td>
                    <td className={ui.num}>{fmtSpan(l.sincePrevNavMs)}</td>
                    <td className={ui.num}>{fmtSpan(l.sincePrevLoadMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Web Vitals por página</h2>
        <p className={ui.hint}>p75 entre as visitas (o limiar pelo qual as Web Vitals são avaliadas), com o último valor de cada visita. Verde/laranja/vermelho: bom, a melhorar, ruim.</p>
        <QueryState isLoading={vitals.isLoading} error={vitals.error} empty={vitals.data?.length === 0} emptyText="Nenhuma métrica ainda (são enviadas quando a aba fica oculta)." />
        {vitalPages.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Página</th>
                  {vitalNames.map((n) => (
                    <th key={n} className={ui.num}>
                      {n} p75
                    </th>
                  ))}
                  <th className={ui.num}>Visitas</th>
                </tr>
              </thead>
              <tbody>
                {vitalPages.map((p) => {
                  const rows = (vitals.data ?? []).filter((v) => v.page === p);
                  return (
                    <tr key={p ?? ""}>
                      <td className={ui.mono}>{path(p)}</td>
                      {vitalNames.map((n) => {
                        const v = rows.find((r) => r.name === n);
                        return (
                          <td key={n} className={`${ui.num} ${v ? vitalClass(n, v.p75) : ""}`} title={v ? `p50 ${fmtVital(n, v.p50)} · máx ${fmtVital(n, v.max)}` : undefined}>
                            {v ? fmtVital(n, v.p75) : "—"}
                          </td>
                        );
                      })}
                      <td className={ui.num}>{fmtInt(Math.max(0, ...rows.map((r) => r.views)))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Primeira requisição × seguintes</h2>
        <p className={ui.hint}>
          A primeira requisição a cada URL paga DNS, conexão e um servidor frio; as seguintes reaproveitam tudo. Com o cabeçalho Server-Timing, Rede ≈ TTFB − App: o tempo
          esperado que o servidor não gastou trabalhando. Recursos de outra origem sem Timing-Allow-Origin só mostram a duração.
        </p>
        <div className={ui.toolbar}>
          <select className={ui.select} value={initiator} onChange={(e) => setInitiator(e.target.value)}>
            <option value="fetch">fetch</option>
            <option value="xmlhttprequest">XHR</option>
            <option value="script">scripts</option>
            <option value="link">CSS / link</option>
            <option value="img">imagens</option>
            <option value="">todos</option>
          </select>
        </div>
        <QueryState isLoading={resources.isLoading} error={resources.error} empty={resources.data?.length === 0} emptyText="Nenhum recurso desse tipo." />
        {resources.data && resources.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>URL</th>
                  <th className={ui.num}>Req.</th>
                  <th className={ui.num}>TTFB 1ª</th>
                  <th className={ui.num}>TTFB seguintes (p50)</th>
                  <th className={ui.num}>Conexão 1ª</th>
                  <th className={ui.num}>Duração 1ª</th>
                  <th className={ui.num}>Duração seguintes</th>
                  <th className={ui.num}>App</th>
                  <th className={ui.num}>DB</th>
                  <th className={ui.num}>Rede</th>
                  <th className={ui.num}>Tamanho</th>
                  <th className={ui.num}>Cache</th>
                </tr>
              </thead>
              <tbody>
                {resources.data.map((r) => (
                  <tr key={`${r.url}-${r.initiator}`}>
                    <td className={ui.mono}>{path(r.url)}</td>
                    <td className={ui.num}>{fmtInt(r.requests)}</td>
                    <td className={ui.num}>{fmtMs(r.firstTtfb)}</td>
                    <td className={ui.num}>{fmtMs(r.laterTtfb)}</td>
                    <td className={ui.num}>{fmtMs(r.firstConnect)}</td>
                    <td className={ui.num}>{fmtMs(r.firstDuration)}</td>
                    <td className={ui.num}>{fmtMs(r.laterDuration)}</td>
                    <td className={ui.num}>{fmtMs(r.app)}</td>
                    <td className={ui.num}>{fmtMs(r.db)}</td>
                    <td className={ui.num}>{fmtMs(r.network)}</td>
                    <td className={ui.num}>{fmtBytes(r.avgBytes)}</td>
                    <td className={ui.num}>{fmtPct(r.cachedShare)}</td>
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

// ─── Servidor ───────────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown) => (typeof v === "number" ? v : null);

/** the headline number of a sample and the details under it */
function describe(s: HostSample): { value: string; details: string[] } {
  const d = s.data;
  switch (s.type) {
    case "process.memory":
      return { value: fmtBytes(num(d.rssBytes)), details: [`heap ${fmtBytes(num(d.heapUsedBytes))} / ${fmtBytes(num(d.heapTotalBytes))}`, `external ${fmtBytes(num(d.externalBytes))}`] };
    case "gc":
      return { value: `${fmtInt(num(d.count))} GCs`, details: [`total ${fmtMs(num(d.totalMs))}`, `maior pausa ${fmtMs(num(d.maxMs))}`] };
    case "event-loop.delay":
      return { value: `p99 ${fmtMs(num(d.p99Ms))}`, details: [`p50 ${fmtMs(num(d.p50Ms))} · p95 ${fmtMs(num(d.p95Ms))}`, `média ${fmtMs(num(d.meanMs))} · máx ${fmtMs(num(d.maxMs))}`] };
    case "event-loop.utilization":
      return { value: fmtPct(num(d.utilization)), details: ["do tempo com o loop ocupado"] };
    case "http.request":
    case "db.query":
      return { value: `p95 ${fmtMs(num(d.p95Ms))}`, details: [`${fmtInt(num(d.count))}× · p50 ${fmtMs(num(d.p50Ms))} · máx ${fmtMs(num(d.maxMs))}`] };
    case "process.heap": {
      const spaces = (d.spaces ?? {}) as Record<string, { usedBytes?: number; sizeBytes?: number }>;
      const top = Object.entries(spaces)
        .sort((a, b) => (b[1].usedBytes ?? 0) - (a[1].usedBytes ?? 0))
        .slice(0, 3)
        .map(([k, v]) => `${k} ${fmtBytes(num(v.usedBytes))}`);
      return { value: `limite ${fmtBytes(num(d.heapSizeLimitBytes))}`, details: [...top, ...(num(d.detachedContexts) ? [`${d.detachedContexts} contextos desanexados`] : [])] };
    }
    case "cache": {
      const hits = num(d.hits) ?? 0;
      const total = hits + (num(d.misses) ?? 0);
      return {
        value: total ? `${fmtPct(hits / total)} hits` : "sem leituras",
        details: [
          `${fmtInt(hits)} hits · ${fmtInt(num(d.misses))} misses`,
          `${fmtInt(num(d.entries))} entradas · ${fmtBytes(num(d.bytes))}${num(d.maxBytes) ? ` / ${fmtBytes(num(d.maxBytes))}` : ""}`,
          `${fmtInt(num(d.evictions))} despejos · ${fmtInt(num(d.invalidations))} invalidações${d.feedUp === false ? " · feed fora" : ""}`,
        ],
      };
    }
    case "win.process":
      return {
        value: fmtBytes(num(d.workingSetBytes)),
        details: [
          `privado ${fmtBytes(num(d.privateBytes))}${num(d.cpuPct) !== undefined ? ` · CPU ${d.cpuPct}%` : ""}`,
          `${fmtInt(num(d.handles))} handles · ${fmtInt(num(d.gdiObjects))} GDI · ${fmtInt(num(d.userObjects))} USER`,
          ...(num(d.ioReadBytes) !== undefined ? [`E/S ${fmtBytes(num(d.ioReadBytes))} lidos · ${fmtBytes(num(d.ioWriteBytes))} escritos`] : []),
        ],
      };
    case "win.job":
      return {
        value: `${fmtInt(num(d.activeProcesses))} processos`,
        details: [
          `pico ${fmtBytes(num(d.peakJobMemoryBytes))}${num(d.cpuPct) !== undefined ? ` · CPU ${d.cpuPct}%` : ""}`,
          `${fmtInt(num(d.terminatedProcesses))} encerrados de ${fmtInt(num(d.totalProcesses))}${d.killOnClose ? " · kill-on-close" : ""}`,
        ],
      };
    case "win.system":
      return {
        value: `memória ${num(d.memoryLoadPct) ?? "?"}%`,
        details: [
          `${fmtBytes(num(d.availPhysBytes))} livres de ${fmtBytes(num(d.totalPhysBytes))}${num(d.cpuPct) !== undefined ? ` · CPU ${d.cpuPct}%` : ""}`,
          `commit ${fmtBytes(num(d.commitBytes))} / ${fmtBytes(num(d.commitLimitBytes))}`,
          `${fmtInt(num(d.processes))} processos · ${fmtInt(num(d.threads))} threads`,
        ],
      };
    case "win.etw": {
      const top = Object.entries((d.byEvent ?? {}) as Record<string, number>).slice(0, 3).map(([k, n]) => `${k} ${fmtInt(n)}`);
      return { value: `${fmtInt(num(d.events))} eventos`, details: [...top, ...(num(d.dropped) ? [`${fmtInt(num(d.dropped))} descartados`] : []), ...(d.status ? [String(d.status)] : [])] };
    }
    case "win.pdh":
      return { value: "PDH", details: Object.entries((d.values ?? {}) as Record<string, number | null>).map(([k, v]) => `${k} ${v === null ? "—" : Math.round(v * 100) / 100}`) };
    case "go.runtime":
      return { value: fmtBytes(num(d.heapAllocBytes)), details: [`${fmtInt(num(d.goroutines))} goroutines`, `GC total ${fmtMs(num(d.gcPauseTotalMs))}`] };
    // erp-cache's startup measurements: first connection / SELECT 1 / first read of every table, and the
    // first vs second answer of each warm-up path
    case "cold-start": {
      const db = (d.db ?? null) as { connectMs?: number; select1Ms?: number; tablesMs?: number; tables?: unknown[]; migrations?: number; missing?: string[]; err?: string } | null;
      const warm = (Array.isArray(d.warmup) ? d.warmup : []) as { path: string; status: number; coldMs: number; warmMs: number }[];
      const details: string[] = [];
      if (db?.err) details.push(`banco: ${db.err}`);
      else if (db) {
        details.push(`conexão ${fmtMs(num(db.connectMs))} · SELECT 1 ${fmtMs(num(db.select1Ms))}`);
        details.push(`${fmtInt(db.tables?.length ?? 0)} tabelas lidas em ${fmtMs(num(db.tablesMs))} · ${fmtInt(num(db.migrations))} migrações`);
        if (db.missing?.length) details.push(`ausentes no schema: ${db.missing.join(", ")}`);
      }
      for (const w of warm) details.push(`${w.path} ${w.status}: ${fmtMs(num(w.coldMs))} → ${fmtMs(num(w.warmMs))}`);
      return { value: `${String(d.name ?? "")} a frio`, details };
    }
    default:
      return {
        value: "",
        details: Object.entries(d)
          .filter(([, v]) => typeof v === "number")
          .slice(0, 4)
          .map(([k, v]) => `${k} ${v}`),
      };
  }
}

const CATEGORY_LABEL: Record<string, string> = { runtime: "Runtime", performance: "Desempenho", other: "Outros" };

function Sparkline({ type, instanceId, name, field, minutes }: { type: string; instanceId: string; name: string; field: string; minutes: number }) {
  const q = useQuery({ queryKey: ["host-series", type, minutes], queryFn: () => api.hostSeries(type, minutes), staleTime: 30_000 });
  const pts = (q.data ?? []).filter((p) => p.instanceId === instanceId && p.name === name).map((p) => Number(p.data[field])).filter(Number.isFinite);
  if (pts.length < 2) return null;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(2)},${(30 - ((v - min) / (max - min || 1)) * 28).toFixed(2)}`).join(" ");
  return (
    <svg className={ui.spark} viewBox="0 0 100 32" preserveAspectRatio="none" aria-label={`${field}: ${pts.length} pontos`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SPARK_FIELD: Record<string, string> = { "process.memory": "rssBytes", "event-loop.delay": "p99Ms", "event-loop.utilization": "utilization", gc: "totalMs", "http.request": "p95Ms", "db.query": "p95Ms", cache: "hits", "go.runtime": "heapAllocBytes", "win.process": "workingSetBytes", "win.system": "memoryLoadPct", "win.job": "activeProcesses", "win.etw": "events" };

function HostView() {
  const [minutes, setMinutes] = useState(60);
  const boots = useQuery({ queryKey: ["host-boots"], queryFn: api.hostBoots });
  const latest = useQuery({ queryKey: ["host-latest", minutes], queryFn: () => api.hostLatest(minutes) });
  const life = useQuery({ queryKey: ["host-lifecycle"], queryFn: api.hostLifecycle });

  const samples = latest.data ?? [];
  const instances = [...new Set(samples.map((s) => `${s.source}/${s.instanceId}`))];

  return (
    <>
      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Instâncias e boots</h2>
        <p className={ui.hint}>
          Um bootId por início do processo: um novo boot da mesma instância é um reinício. A sequência dos lotes começa em 0 a cada boot; números que faltam são lotes perdidos, e
          um lote reenviado conta como duplicado.
        </p>
        <QueryState isLoading={boots.isLoading} error={boots.error} empty={boots.data?.length === 0} emptyText="Nenhum serviço enviou telemetria para /telemetry/host." />
        {boots.data && boots.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Instância</th>
                  <th>Boot</th>
                  <th>Estado</th>
                  <th>Desde</th>
                  <th>Último lote</th>
                  <th className={ui.num}>Lotes</th>
                  <th className={ui.num}>Perdidos</th>
                  <th className={ui.num}>Duplicados</th>
                  <th className={ui.num}>Reinícios antes</th>
                </tr>
              </thead>
              <tbody>
                {boots.data.map((b) => (
                  <tr key={b.bootId}>
                    <td>{b.source}</td>
                    <td className={ui.mono}>{b.instanceId}</td>
                    <td className={ui.mono} title={b.bootId}>
                      {b.bootId.slice(0, 8)}
                    </td>
                    <td>
                      {b.lastState ? (
                        <span className={`${ui.badge} ${b.lastState === "degraded" ? ui.warn : b.lastState === "stopping" ? ui.muted : ui.ok}`}>{b.lastState}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{fmtWhen(b.firstAt)}</td>
                    <td>{fmtWhen(b.lastAt)}</td>
                    <td className={ui.num}>
                      {fmtInt(b.batches)} <span className={ui.muted}>(#{b.firstSeq}–{b.lastSeq})</span>
                    </td>
                    <td className={`${ui.num} ${b.missing ? ui.bad : ""}`}>{fmtInt(b.missing)}</td>
                    <td className={`${ui.num} ${b.duplicates ? ui.warn : ""}`}>{fmtInt(b.duplicates)}</td>
                    <td className={ui.num}>{fmtInt(b.restarts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Últimas medições</h2>
        <p className={ui.hint}>
          Runtime: memória e GC. Desempenho: atraso do event loop (histograma do monitorEventLoopDelay, p50/p95/p99), utilização do loop, e a duração das requisições e consultas
          por rota. O gráfico mostra a janela escolhida; amostras mais antigas que a retenção bruta voltam como médias por minuto.
        </p>
        <div className={ui.toolbar}>
          <select className={ui.select} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            <option value={15}>15 min</option>
            <option value={60}>1 h</option>
            <option value={360}>6 h</option>
            <option value={1440}>24 h</option>
          </select>
        </div>
        <QueryState isLoading={latest.isLoading} error={latest.error} empty={samples.length === 0} emptyText="Nenhuma medição nessa janela." />
        {instances.map((inst) => (
          <div key={inst}>
            <h3 className={ui.kv}>{inst}</h3>
            {["runtime", "performance", "other"].map((cat) => {
              const rows = samples.filter((s) => `${s.source}/${s.instanceId}` === inst && s.category === cat);
              if (!rows.length) return null;
              return (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <p className={ui.kv}>{CATEGORY_LABEL[cat]}</p>
                  <div className={ui.cards}>
                    {rows.map((s) => {
                      const { value, details } = describe(s);
                      return (
                        <div key={`${s.type}/${s.name}`} className={ui.card}>
                          <div className={ui.cardHead}>
                            <span>{s.type}</span>
                            <span>{fmtWhen(s.at)}</span>
                          </div>
                          {s.name && <div className={`${ui.kv} ${ui.mono}`}>{s.name}</div>}
                          {value && <div className={ui.cardValue}>{value}</div>}
                          {details.map((t) => (
                            <div key={t} className={ui.kv}>
                              {t}
                            </div>
                          ))}
                          {SPARK_FIELD[s.type] && <Sparkline type={s.type} instanceId={s.instanceId} name={s.name} field={SPARK_FIELD[s.type]!} minutes={minutes} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Ciclo de vida</h2>
        <QueryState isLoading={life.isLoading} error={life.error} empty={life.data?.length === 0} emptyText="Nenhum evento de ciclo de vida." />
        {life.data && life.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Serviço</th>
                  <th>Instância</th>
                  <th>Boot</th>
                  <th>Estado</th>
                  <th className={ui.num}>Uptime</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {life.data.map((l, i) => (
                  <tr key={`${l.bootId}-${l.at}-${l.state}-${i}`}>
                    <td>{fmtWhen(l.at)}</td>
                    <td>{l.source}</td>
                    <td className={ui.mono}>{l.instanceId}</td>
                    <td className={ui.mono}>{l.bootId.slice(0, 8)}</td>
                    <td>
                      <span className={`${ui.badge} ${l.state === "degraded" || l.state === "restarted" ? ui.warn : ui.ok}`}>{l.state}</span>
                    </td>
                    <td className={ui.num}>{fmtSpan(l.uptimeMs)}</td>
                    <td className={ui.muted}>{l.reason ?? ""}</td>
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

// ─── Envios ─────────────────────────────────────────────────────────────────────────────────────────

function UploadsView() {
  const stats = useQuery({ queryKey: ["ingest-stats"], queryFn: api.stats });
  const batches = useQuery({ queryKey: ["ingest-batches"], queryFn: api.batches });
  const seqs = useQuery({ queryKey: ["ingest-sequences"], queryFn: api.sequences });

  return (
    <>
      <section className={ui.panel}>
        <h2 className={ui.panelTitle}>Sequência dos envios da extensão</h2>
        <p className={ui.hint}>Por início do service worker (bootId). Um reenvio de um envio que já chegou não é guardado de novo; números que faltam são envios perdidos.</p>
        <QueryState isLoading={seqs.isLoading} error={seqs.error} empty={seqs.data?.length === 0} emptyText="Nenhum envio com sequência (extensão 0.4+)." />
        {seqs.data && seqs.data.length > 0 && (
          <div className={ui.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Quem</th>
                  <th>Boot</th>
                  <th>De</th>
                  <th>Até</th>
                  <th className={ui.num}>Envios</th>
                  <th className={ui.num}>Sequência</th>
                  <th className={ui.num}>Perdidos</th>
                </tr>
              </thead>
              <tbody>
                {seqs.data.map((s) => (
                  <tr key={s.bootId}>
                    <td className={ui.mono}>{s.label || s.installId?.slice(0, 8) || "—"}</td>
                    <td className={ui.mono}>{s.bootId.slice(0, 8)}</td>
                    <td>{fmtWhen(s.firstAt)}</td>
                    <td>{fmtWhen(s.lastAt)}</td>
                    <td className={ui.num}>{fmtInt(s.uploads)}</td>
                    <td className={ui.num}>
                      #{s.firstSeq}–{s.lastSeq}
                    </td>
                    <td className={`${ui.num} ${s.missing ? ui.bad : ""}`}>{fmtInt(s.missing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                  <th className={ui.num}>Seq.</th>
                  <th className={ui.num}>Eventos</th>
                  <th className={ui.num}>Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {batches.data.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtWhen(b.receivedAt)}</td>
                    <td>{b.kind}</td>
                    <td className={ui.mono}>{b.label || b.installId?.slice(0, 8) || "—"}</td>
                    <td>{b.extVersion ?? "—"}</td>
                    <td className={ui.num} title={b.bootId ?? undefined}>
                      {b.sequence ?? "—"}
                    </td>
                    <td className={ui.num}>{fmtInt(b.eventCount)}</td>
                    <td className={ui.num}>{fmtBytes(b.bytes)}</td>
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
