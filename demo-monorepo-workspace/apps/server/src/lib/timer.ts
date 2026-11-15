// How routes time their database work. With host telemetry on (index.ts), this is the collector's
// `query`: counted as a db.query sample and added to the response's Server-Timing "db". Otherwise
// (tests, HOST_TELEMETRY=off) it just runs the function.
export interface Timer {
  query<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
}

export const noTimer: Timer = { query: async (_name, fn) => fn() };
