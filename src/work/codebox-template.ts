// The source a new codebox starts with: a small one-pole low-pass written with
// the unworklet core API, to show the shape of a codebox.
export const CODEBOX_TEMPLATE = `import { defineSubgraph, f32, state, type Node } from '@unworklet/core';

// tick receives the declared inputs and returns the declared outputs.
export default defineSubgraph((config: { sampleRate: number }) => {
  const last = state.f32(0).named('last');
  return {
    tick(i: { in: Node<'f32'> }) {
      // one-pole smoother as an example
      const y = last.read().add(i.in.sub(last.read()).mul(0.1));
      last.write(y);
      return { out: y };
    },
  };
});
`;
