// sound: the patch as audio. It describes the den blocks, wires and compiles a
// patch, codebox code included, into WebAssembly with unworklet in a disposable
// worker, and plays it in an AudioWorklet. A new parameter value reaches the
// running audio without recompiling; a changed patch replaces it with a short
// crossfade. Audio assets reach the patch as samples the page decodes and sends:
// a sampler's sound, and what a codebox reads through `@den-kit/assets`;
// pointing a sampler at another sound sends new samples without recompiling.
// The output passes a safety stage (limiter, clipper, mute for broken audio)
// before the speakers. sound imports only work, and never the screen:
// the parameters are the only values the two share.
export {};
