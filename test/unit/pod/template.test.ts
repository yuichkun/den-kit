import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { applyIntents } from '../../../src/core/ops.ts';
import { checkProjectPath } from '../../../src/core/project.ts';
import { starter } from '../../../src/core/starters.ts';
import { pluginSpec } from '../../../src/plugin/build.ts';
import { controlsSource, starterPart, templateFiles } from '../../../src/pod/template.ts';

const syntaxErrors = (text: string) => ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).diagnostics ?? [];

describe('pod template', () => {
  it('is a whole web project, without the files den-kit makes, and every path may be kept', () => {
    const files = templateFiles();
    for (const path of ['package.json', 'package-lock.json', 'AGENTS.md', '.gitignore', 'index.html', 'vite.config.ts', 'tsconfig.json', 'eslint.config.js', 'src/main.ts', 'src/kit/index.ts', 'src/kit/runtime.ts'])
      expect(files[path], path).toBeTypeOf('string');
    expect(files['src/kit/controls.ts']).toBeUndefined();
    for (const path of Object.keys(files)) expect(checkProjectPath(path), path).toBeNull();
    const pkg = JSON.parse(files['package.json']!);
    expect(pkg.scripts).toMatchObject({ dev: 'vite', check: 'tsc --noEmit', build: 'vite build' });
    // ESLint is handed the files: in BrowserPod (its Node 22.15) ESLint's own folder search finds nothing.
    expect(pkg.scripts.lint).toMatch(/^eslint \$\(find \. .*-prune -o -type f .*-print\)$/);
    // Native binaries do not run in the pod: the WebAssembly builds stand in.
    expect(pkg.overrides).toMatchObject({ esbuild: expect.stringContaining('esbuild-wasm'), rollup: expect.stringContaining('@rollup/wasm-node') });
    // The lockfile matches package.json (installs are the same everywhere) and has no native builds in it.
    const lock = JSON.parse(files['package-lock.json']!);
    expect(lock.packages[''].devDependencies).toEqual(pkg.devDependencies);
    expect(lock.packages['node_modules/esbuild'].name).toBe('esbuild-wasm');
    expect(lock.packages['node_modules/rollup'].name).toBe('@rollup/wasm-node');
    expect(Object.keys(lock.packages).filter(k => /@esbuild\/|@rollup\/rollup-/.test(k))).toEqual([]);
  });
  it('the starter part is valid TypeScript', () => {
    expect(syntaxErrors(starterPart('meter'))).toEqual([]);
  });
  it('controls.ts lists the patch\'s controls with their ranges, as valid TypeScript', () => {
    const doc = applyIntents(starter('bass', catalog), [
      { op: 'addNode', node: { id: 'kcut', type: 'ui.knob', label: 'Cutoff', config: { min: 20, max: 20000, scale: 'log', unit: 'Hz' } } },
      { op: 'addNode', node: { id: 'son', type: 'ui.toggle', label: 'On' } },
    ], catalog).doc;
    const controls = pluginSpec(doc, catalog, { probes: [] }).controls;
    const text = controlsSource(controls);
    expect(syntaxErrors(text)).toEqual([]);
    const ids = Object.keys(controls).filter(id => ['ui.knob', 'ui.slider', 'ui.toggle', 'ui.button', 'ui.xy'].includes(controls[id]!.type));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(text).toContain(`${JSON.stringify(id)}: { kind:`);
    expect(text).toContain('"kcut": { kind: "knob", label: "Cutoff", min: 20, max: 20000, scale: "log", unit: "Hz" },');
    expect(text).toContain('"son": { kind: "switch", label: "On" },');
    expect(controlsSource({})).toContain('export const CONTROLS = {\n} as const;');
  });
});
