// Footer readout of the last scheduler decision, for humans; the harness reads window.__shop.
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useCatalogStore } from "../../stores/catalog.store.js";
import styles from "./SchedulerStatus.module.scss";

/** @param {{ framework: string, workerError: string | null }} props */
export function SchedulerStatus({ framework, workerError }) {
  const r = useCatalogStore((s) => s.result);
  return (
    <div className={styles.bar} data-testid="scheduler-status">
      <Chip size="small" label={framework} />
      {r ? (
        <>
          <Chip size="small" color={r.target === "worker" ? "primary" : "default"} label={r.target} />
          <Typography variant="caption">
            {r.decision.reason} · resultado {r.totalMs.toFixed(1)} ms · bloqueio {r.mainBlockedMs.toFixed(1)} ms · previsto main {r.decision.predMainMs.toFixed(1)} / worker{" "}
            {r.decision.predWorkerMs.toFixed(1)} ms · orçamento {r.decision.budgetMs.toFixed(1)} ms
          </Typography>
        </>
      ) : (
        <Typography variant="caption">aguardando…</Typography>
      )}
      {workerError && <Chip size="small" color="warning" label={`sem worker: ${workerError}`} />}
    </div>
  );
}
