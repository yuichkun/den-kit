// The screen project a work starts with (pod-template: Vite, TypeScript,
// ESLint, den-kit's SDK for code parts, and a guide for the AI), and the one file
// den-kit writes from the patch on every change: src/kit/controls.ts, the
// controls a part can read and move, with their ranges, as code (so a wrong id
// is a type error).
import { GENERATED_FILES, textFiles, type WorkFile } from '../work/files.ts';
import type { Parameter } from '../work/parameters.ts';

const raw = import.meta.glob('/pod-template/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
/** (Dotfiles are not picked up by the glob.) */
const GITIGNORE = 'node_modules\ndist\n';

/** The template's files by path, as kept in the work (den-kit's generated files are left out). */
export function templateFiles(): Record<string, string> {
  const files: Record<string, string> = { '.gitignore': GITIGNORE };
  for (const [key, text] of Object.entries(raw)) {
    const path = key.replace(/^\/pod-template\//, '');
    if (GENERATED_FILES.has(path) || path.startsWith('node_modules/')) continue;
    files[path] = text;
  }
  return files;
}

/**
 * Files to put in a work: while the work has no sources yet, the template comes
 * with them (a part never arrives without the project that shows it).
 */
export function withTemplate(
  work: Readonly<Record<string, WorkFile>>,
  files: Record<string, string | null>,
): Record<string, string | null> {
  return Object.keys(textFiles(work)).length ? files : { ...templateFiles(), ...files };
}

/** A new code part's file (Insert ▸ Code part): something that moves, to start from. */
export function starterPart(name: string): string {
  return `import { part } from '../kit';

// "${name}": a code part. Edit freely — den-kit shows it on the plugin and
// reloads it when this file changes. AGENTS.md explains what \`kit\` gives you.
export default part({
  props: {
    color: { type: 'color', default: 'accent', label: 'Colour' },
  },
  mount(root, kit) {
    const canvas = root.appendChild(document.createElement('canvas'));
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    const g = canvas.getContext('2d')!;
    return kit.frame(() => {
      const dpr = devicePixelRatio, w = kit.size.width, h = kit.size.height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const style = getComputedStyle(root);
      g.strokeStyle = style.getPropertyValue(\`--dk-\${kit.props.color}\`) || kit.props.color;
      g.lineWidth = 2;
      g.beginPath();
      kit.audio.wave.forEach((s, i) => { const x = (i / (kit.audio.wave.length - 1)) * w, y = h / 2 - s * h * 0.45; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    });
  },
});
`;
}

const literal = (v: unknown) => JSON.stringify(v);

/** src/kit/controls.ts for the patch's controls (knobs, sliders, switches, buttons, XY pads; on the plugin or not). */
export function controlsSource(controls: Readonly<Record<string, Parameter>>): string {
  const lines: string[] = [];
  for (const c of Object.values(controls).sort((a, b) => a.id.localeCompare(b.id))) {
    const fields: string[] = [`kind: ${literal(c.kind)}`, `label: ${literal(c.label)}`];
    if (c.kind === 'knob' || c.kind === 'slider') {
      fields.push(
        `min: ${Number(c.min ?? 0)}`,
        `max: ${Number(c.max ?? 1)}`,
        `scale: ${literal(c.scale === 'log' ? 'log' : 'linear')}`,
      );
      if (c.unit) fields.push(`unit: ${literal(c.unit)}`);
    }
    lines.push(`  ${literal(c.id)}: { ${fields.join(', ')} },`);
  }
  return `// Made by den-kit from the patch: the controls a part can read and move.
// Rewritten whenever the patch changes; do not edit (changes are lost).
export const CONTROLS = {
${lines.join('\n')}${lines.length ? '\n' : ''}} as const;
export type ControlId = keyof typeof CONTROLS;
`;
}
