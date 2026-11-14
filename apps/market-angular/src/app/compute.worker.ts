// Entry Angular bundles as the module worker. It only pulls in the core worker, so this app and the
// React one run byte-for-byte the same compute code.
import "@core/worker/worker.js";
