// sound: the patch as audio (docs/architecture.md, "Sound"). It describes den's
// blocks and den-kit's own nodes, compiles a patch, codebox code included, into
// WebAssembly with unworklet in a disposable worker without fetch, sockets or
// storage, and plays it in an AudioWorklet. Audio assets reach the patch as samples
// the page decodes and sends: a sampler's sound, and what a codebox reads through
// `@den-kit/assets`; pointing a sampler at another sound sends new samples without
// recompiling. sound imports only work.
export {};
