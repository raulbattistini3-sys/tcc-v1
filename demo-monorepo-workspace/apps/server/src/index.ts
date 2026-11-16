// tcc-v2.exe's entry (and pnpm start's, through start.ts). TCC_MODE picks what the process is:
//   (unset)      the HTTP server (server.ts): ingest, telemetry, the dashboard
//   ingest-ipc   a service's telemetry child (ingest-ipc.ts): stores the envelopes the service sends over
//                Node IPC and reports the service's job object back to it; no port
// One executable for both, so the launcher ships nothing more and the child finds win_telemetry.node
// beside it. No top-level await: `bun build --bytecode` emits CommonJS, where there is none.
const mode = process.env.TCC_MODE === "ingest-ipc" ? import("./ingest-ipc.js") : import("./server.js");
mode.catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
