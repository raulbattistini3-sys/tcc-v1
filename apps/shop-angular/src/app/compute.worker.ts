// Entry Angular bundles as the module worker. It only pulls in the core
// worker, so this shop and the React one run byte-for-byte the same compute code.
import "@core/worker/worker.js";
