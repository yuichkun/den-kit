# The screen of a den-kit work

This folder is the plugin screen's web project for one den-kit work (a sound
made from den blocks, plus its screen). You are in a real Linux environment that
runs inside the musician's browser: bash, git, Node and npm, the usual tools.
Use them as you would in any web project.

- The sound is the patch (den-kit's graph). You change it with den-kit's tools
  (kit_apply_ops and the others), not with files here.
- The screen is made of den-kit's own controls and decorations (also changed with
  kit_apply_ops) and of **code parts**: parts of this project shown in their own
  box on the plugin. Write a code part when the screen needs something den-kit's
  controls and decorations do not do — your own look, motion, 3D, a display of
  the sound, a control that behaves its own way. A code part may also fill the
  whole plugin.

## Code parts

A code part is a file `src/parts/<name>.ts` (name: lowercase letters, digits,
dashes) whose default export is `part({...})`:

```ts
import { CONTROLS, behaviors, part } from '../kit';

export default part({
  // Settings shown in den-kit's inspector (the musician changes them without code).
  props: {
    color: { type: 'color', default: 'accent', label: 'Colour' },
    speed: { type: 'number', default: 1, min: 0, max: 4, step: 0.1, label: 'Speed' },
  },
  // false: a backdrop that lets the mouse through to the controls under it.
  interactive: true,
  mount(root, kit) {
    const canvas = root.appendChild(document.createElement('canvas'));
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    const g = canvas.getContext('2d')!;
    let angle = 0;
    const stop = kit.frame(dt => {
      const dpr = devicePixelRatio,
        w = kit.size.width,
        h = kit.size.height;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      angle += dt * kit.props.speed * (0.5 + kit.audio.level * 4);
      g.strokeStyle = getComputedStyle(root).getPropertyValue('--dk-accent');
      g.lineWidth = 6;
      g.beginPath();
      g.arc(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.35,
        angle,
        angle + Math.PI * (0.2 + kit.norm('kcut') * 1.6),
      );
      g.stroke();
      // … kit.audio.wave, kit.audio.spectrum, kit.value('kcut') …
    });
    // The canvas is a knob with den-kit's knob behavior: drag up and down, the
    // wheel, the arrow keys, a double-click for the default; one drag is one ⌘Z step.
    const knob = behaviors.createKnob(CONTROLS.kcut);
    const unbind = kit.bind(knob, 'kcut');
    const unlisten = behaviors.listen(canvas, knob);
    return () => {
      stop();
      unbind();
      unlisten();
    };
  },
});
```

Put it on the plugin with den-kit's kit_apply_ops:
`{"op":"addElement","element":{"kind":"code","part":"<name>","rect":{"x":0,"y":0,"w":300,"h":200},"props":{"speed":2}}}`.
The same part can be placed several times with different props.

### What `kit` gives a part (src/kit/index.ts has the details)

- `kit.value(id)`, `kit.norm(id)`, `kit.on(id, fn)` — the patch's controls (knobs,
  sliders, switches, XY pads). **src/kit/controls.ts lists them** with their
  ranges and units; den-kit rewrites it whenever the patch changes (do not edit
  it). A wrong id is a type error.
- `kit.set(id, v)`, `kit.setNorm(id, n)`, `kit.begin()` / `kit.end()` — move a
  control; the sound follows at once and the musician can undo it. To move a
  sound parameter that has no control yet, add one in the patch first (a knob
  wired to that input; it need not be on the plugin).
- `behaviors` — how den-kit's own controls respond to input, without their look:
  `createKnob`, `createSlider`, `createButton`, `createSwitch`, `createXYPad`,
  `createKeyboard`, `createMeter`. `behaviors.listen(element, behavior)` feeds a
  behavior the element's pointer, wheel and keys, and `kit.bind(behavior, id)`
  lets it move a control. A control drawn this way behaves like den-kit's (same
  drag, wheel and keys, one drag one ⌘Z step); prefer it to handling input by hand.
- `kit.audio` — the plugin's output now: `level`, `peak`, `wave` (256 samples),
  `spectrum` (64 bands, low to high, 0..1). Read it in `kit.frame(...)`.
- `kit.props` / `kit.onProps(fn)` — this part's settings.
- `kit.look` and the CSS variables `--dk-bg`, `--dk-fg`, `--dk-accent`,
  `--dk-track`, `--dk-knob`, `--dk-pointer`, `--dk-muted`, `--dk-glow`,
  `--dk-font`, `--dk-label-font`, `--dk-value-font` — the work's look, so a part
  belongs to the same plugin.
- `kit.size`, `kit.onResize(fn)` — the box in design pixels (draw for
  `devicePixelRatio`).
- `kit.mode` — `'play'` or `'edit'` (being laid out; no mouse then).
- `kit.asset(id)` — a picture or font of the work, as a URL.

## Tools

- Any npm package: `npm install three`, `gsap`, `d3`, `pixi.js`, … Packages
  that ship native binaries do not run here; most have a WebAssembly build
  (see the `overrides` in package.json for esbuild and rollup).
- `npm run check` (TypeScript), `npm run lint` (ESLint), `npm run build` (Vite):
  run them before you finish. ESLint cannot search folders in this pod (its
  Node has a fault there), so `npm run lint` hands it the files; to lint a few,
  name them: `npx eslint src/parts/meter.ts`.
- The dev server is already running (den-kit starts it and shows the parts from
  it); do not start another. Saving a file updates the plugin.
- git works as usual. den-kit also commits after each request.
- The network inside reaches the npm registry and GitHub, not arbitrary sites.

## Making it good

- Make the screen fit this work (its name, its sound, the design brief, the
  reference pictures) — not a generic template.
- Use the work's look (the `--dk-*` variables) unless the part is meant to stand
  out; draw crisp at `devicePixelRatio`; keep text readable.
- Keep it light: it runs inside a plugin. One animation loop through
  `kit.frame`, nothing heavy per frame, no timers left running after unmount.
- Look at the result with den-kit's kit_look (it shows code parts and reports
  their errors), and fix what you see.
