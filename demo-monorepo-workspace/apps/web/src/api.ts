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

export type IngestBatch = {
  id: string;
  receivedAt: string;
  kind: string;
  installId: string | null;
  label: string | null;
  extVersion: string | null;
  bootId: string | null;
  sequence: number | null;
  eventCount: number;
  bytes: number;
};

/** the request timeline the probe reports for a page or a resource (ms) */
export type Timeline = {
  protocol?: string;
  redirect?: number;
  dns?: number;
  connect?: number;
  tls?: number;
  queue?: number;
  ttfb?: number;
  download?: number;
  duration?: number;
  reusedConnection?: boolean;
  timingAllowed?: boolean;
  transferSize?: number;
  cached?: boolean;
  serverTiming?: Record<string, number>;
};
export type PageLoad = {
  installId: string | null;
  tabId: number | null;
  page: string | null;
  navigatedAt: string;
  nthInTab: number | string;
  sincePrevNavMs: number | null;
  sincePrevLoadMs: number | null;
  firstForOrigin: boolean;
  data: Timeline & { navType?: string; ttfb?: number; domContentLoaded?: number; load?: number; responseStart?: number };
};
export type Vital = { page: string | null; name: string; views: number; p50: number; p75: number; max: number };
export type ResourceRow = {
  url: string | null;
  initiator: string | null;
  requests: number;
  firstTtfb: number | null;
  laterTtfb: number | null;
  firstDuration: number | null;
  laterDuration: number | null;
  firstConnect: number | null;
  app: number | null;
  db: number | null;
  network: number | null;
  avgBytes: number | null;
  cachedShare: number | null;
};
export type UploadSequence = { installId: string | null; label: string | null; bootId: string; uploads: number; firstSeq: number; lastSeq: number; missing: number; firstAt: string; lastAt: string };

export type HostBoot = {
  source: string;
  instanceId: string;
  bootId: string;
  firstAt: string;
  lastAt: string;
  batches: number;
  firstSeq: number;
  lastSeq: number;
  missing: number;
  duplicates: number;
  restarts: number;
  lastState: string | null;
};
export type HostSample = { source: string; instanceId: string; bootId: string; at: string; category: string; type: string; name: string; data: Record<string, unknown> };
export type HostLifecycle = { source: string; instanceId: string; bootId: string; at: string; state: string; reason: string | null; uptimeMs: number | null };
export type HostPoint = { resolution: "raw" | "minute"; instanceId: string; at: string; name: string; data: Record<string, number>; samples: number };
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
  navigation: () => get<PageLoad[]>("/ingest/navigation?limit=200"),
  vitals: () => get<Vital[]>("/ingest/vitals"),
  resources: (initiator: string) => get<ResourceRow[]>(`/ingest/resources${initiator ? `?initiator=${initiator}` : ""}`),
  sequences: () => get<UploadSequence[]>("/ingest/sequences"),
  hostBoots: () => get<HostBoot[]>("/telemetry/host/boots"),
  hostLatest: (minutes: number) => get<HostSample[]>(`/telemetry/host/latest?minutes=${minutes}`),
  hostLifecycle: () => get<HostLifecycle[]>("/telemetry/host/lifecycle"),
  hostSeries: (type: string, minutes: number) => get<HostPoint[]>(`/telemetry/host/series?type=${encodeURIComponent(type)}&minutes=${minutes}`),
};
