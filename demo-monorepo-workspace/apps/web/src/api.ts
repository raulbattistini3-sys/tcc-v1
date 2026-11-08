import type { Site } from "@tcc/contracts";

// The server's read routes. The token lives in this browser's localStorage (typed into the header),
// never in the build.

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN_KEY = "tcc-dashboard-token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the token lasts until reload
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "Token inválido ou ausente" : `${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type SweepRun = {
  id: string;
  createdAt: string;
  source: string;
  app: string;
  framework: string | null;
  throttling: number;
  datasetRows: number | null;
  condition: string | null;
  strategy: string | null;
  transport: string | null;
  notes: string | null;
  results: number;
};

export type SweepCell = {
  strategy: string | null;
  target: string;
  size: number | null;
  queryKind: string | null;
  cold: boolean | null;
  n: number;
  p50Ms: number;
  p95Ms: number;
  p50BlockedMs: number;
  p50PaintMs: number | null;
  predErrorMs: number | null;
};

export type ScrapeRun = {
  id: string;
  createdAt: string;
  site: Site;
  startUrl: string;
  status: string;
  pagesRequested: number;
  pagesFetched: number;
  delayMs: number;
  message: string | null;
  listings: number;
};

export type Listing = {
  id: number;
  runId: string;
  site: Site;
  externalId: string | null;
  title: string;
  url: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  installments: string | null;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  freeShipping: boolean | null;
  imageUrl: string | null;
  page: number;
  position: number;
  scrapedAt: string;
};

export type IngestBatch = { id: string; receivedAt: string; kind: string; installId: string | null; label: string | null; extVersion: string | null; eventCount: number; bytes: number };
export type IngestStat = { source: string; type: string; events: number; last_at: string };

export const api = {
  sweeps: () => get<SweepRun[]>("/sweeps"),
  sweep: (id: string) => get<{ run: SweepRun & Record<string, unknown>; cells: SweepCell[] }>(`/sweeps/${id}`),
  scrapes: (site: Site | "") => get<ScrapeRun[]>(`/scrapes${site ? `?site=${site}` : ""}`),
  listings: (site: Site | "", runId: string) => {
    const q = new URLSearchParams();
    if (site) q.set("site", site);
    if (runId) q.set("runId", runId);
    q.set("limit", "500");
    return get<Listing[]>(`/listings?${q}`);
  },
  batches: () => get<IngestBatch[]>("/ingest/batches"),
  stats: () => get<IngestStat[]>("/ingest/stats"),
};
