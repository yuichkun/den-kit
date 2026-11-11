// The Content Security Policy every host sends with the compile worker's script
// (compiler.worker.ts). A codebox's code runs in that worker while the sound is built,
// and may evaluate any code it makes up; under this policy the worker loads scripts only
// from den-kit's own origin and makes no other request, so the code reaches no network.
export const COMPILE_WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'";

/** Whether a request path is the compile worker's script: its source in development, its build in assets/. */
export function isCompileWorkerScript(path: string): boolean {
  return /^\/(?:src\/sound\/compile\/compiler\.worker\.ts|assets\/compiler\.worker-[\w-]+\.js)$/.test(
    path,
  );
}
