/// <reference types="vite/client" />
declare module 'virtual:kit-modules' {
  const registry: Record<string, unknown>;
  export default registry;
}
declare module 'virtual:kit-runtime' {
  const runtime: string;
  export default runtime;
}
declare module 'virtual:kit-bridge' {
  const bridge: { token: string | null };
  export default bridge;
}
declare module 'virtual:kit-pod' {
  const pod: { apiKey: string | null; fakeUrl: string | null };
  export default pod;
}
declare module 'virtual:kit-types' {
  const snapshot: import('./src/sound/compile/type-project.ts').TypeFiles;
  export default snapshot;
}
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
