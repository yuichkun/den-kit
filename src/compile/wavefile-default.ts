// @unworklet/offline does `import wavefile from "wavefile"` (Node resolves the
// CommonJS build), but browser bundlers pick wavefile's ESM entry, which has no
// default export. vite.config.ts points the bare specifier here instead.
import { WaveFile } from 'wavefile/index.js';

export { WaveFile };
export default { WaveFile };
