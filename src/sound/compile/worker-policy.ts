// The Content Security Policy every host sends with the compile worker's script
// (compiler.worker.ts). A codebox's code runs in that worker while the sound is built,
// and may evaluate any code it makes up; under this policy the worker loads only the
// scripts at the paths where the host serves den-kit's own code, and makes no other
// request, so the code reaches neither the network nor the rest of the host's server.

/** Where a host serves the scripts the compile worker loads: in a build, and on the development server. */
export const WORKER_SCRIPTS = {
  build: ['/assets/'],
  development: [
    '/src/',
    '/node_modules/',
    ...['modules', 'runtime', 'types'].map(name => `/@id/__x00__virtual:kit-${name}`),
  ],
} as const;

/** The policy for the compile worker's script, from a server at `origin` that serves the worker's scripts at `paths`. */
export function compileWorkerPolicy(origin: string, paths: readonly string[]): string {
  return `default-src 'none'; script-src ${paths.map(path => origin + path).join(' ')} 'unsafe-eval' 'wasm-unsafe-eval'`;
}

/** Whether a request path is the compile worker's script: its source in development, its build in assets/. */
export function isCompileWorkerScript(path: string): boolean {
  return /^\/(?:src\/sound\/compile\/compiler\.worker\.ts|assets\/compiler\.worker-[\w-]+\.js)$/.test(
    path,
  );
}
