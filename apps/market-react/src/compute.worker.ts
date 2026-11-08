// Entry Vite bundles as the module worker. It only pulls in the core worker, so this app and the
// Angular one run byte-for-byte the same compute code (as the shops do).
import "@core/worker/worker.js";
