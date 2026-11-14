import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ui from "./ui.module.css";
import { getToken, setToken } from "./api";
import { SweepsPage } from "./pages/SweepsPage";
import { ListingsPage } from "./pages/ListingsPage";
import { TelemetryPage } from "./pages/TelemetryPage";

const TABS = [
  { id: "sweeps", label: "Varreduras" },
  { id: "listings", label: "Anúncios coletados" },
  { id: "telemetry", label: "Telemetria" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<Tab>("sweeps");
  const [token, setTokenState] = useState(getToken);
  const queryClient = useQueryClient();

  return (
    <div className={ui.shell}>
      <header className={ui.header}>
        <h1 className={ui.title}>TCC · registros</h1>
        <nav className={ui.tabs} role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={ui.tab} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <label className={ui.token}>
          Token
          <input
            className={ui.input}
            type="password"
            autoComplete="off"
            value={token}
            placeholder="TCC_TOKEN do servidor"
            onChange={(e) => {
              setTokenState(e.target.value);
              setToken(e.target.value);
            }}
            onBlur={() => void queryClient.invalidateQueries()}
          />
        </label>
      </header>
      {tab === "sweeps" && <SweepsPage />}
      {tab === "listings" && <ListingsPage />}
      {tab === "telemetry" && <TelemetryPage />}
    </div>
  );
}
