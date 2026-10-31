// Keys that play notes, played by den-kit's keyboard behavior: dragging across the
// keys plays each one it reaches, each finger plays its own key, and where a key
// is pressed, top to bottom, sets how hard; emits `note` {note, on, velocity}. The
// computer keys are played by whoever shows the keyboard (they work without
// focus), and the letters they play are printed here.
// Skins: piano (black and white keys; `start`, `octaves`, `held`, and `pc` = the
// note where the computer-keyboard letters are printed), pads (big pads in a grid,
// one note each, stepping through a scale). The piano's colors can be set with
// --dk-key-white, --dk-key-black, --dk-key-line, --dk-key-label, --dk-key-down,
// --dk-key-down-label and --dk-key-down-black: den-kit's keyboard bar sets them from
// its theme, and a plugin leaves them unset.
import { Keyboard, listen, velocityAt } from '../../behaviors/index.ts';
import { BASE_CSS, DkElement, col, escapeHtml } from './base.ts';

const SCALES: Record<string, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  same: [0],
};
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
/** The notes of `count` pads starting at `start`, stepping through `scale` (octave by octave). */
export function padNotes(count: number, start: number, scale: string): number[] {
  const steps = SCALES[scale] ?? SCALES.major!;
  if (scale === 'same') return Array.from({ length: count }, () => start);
  return Array.from(
    { length: count },
    (_, i) => start + 12 * Math.floor(i / steps.length) + steps[i % steps.length]!,
  );
}

export class DkKeyboard extends DkElement {
  static observedAttributes = ['octave', 'start', 'octaves', 'held', 'pc', 'skin', 'params'];
  protected static override readonly painted = ['held'];
  private readonly keys = new Keyboard({ low: 48, high: 72, width: 1, height: 1 });
  private stopListening: (() => void) | null = null;
  constructor() {
    super();
    this.keys.events.on(e => {
      if (e.type === 'begin') this.holding = true;
      else if (e.type === 'value') {
        const { note, velocity } = e.value;
        this.emit('note', { note, on: velocity > 0, velocity });
        this.paint();
      } else this.ended();
    });
  }
  override attributeChangedCallback(name: string) {
    // Lit keys follow `held` even while a key is pressed (another key, the computer keyboard, MIDI).
    if (name === 'held' && this.root.firstChild) {
      this.paint();
      return;
    }
    super.attributeChangedCallback(name);
  }
  protected build() {
    const params = this.readParams();
    const html = this.skinName === 'pads' ? this.pads(params) : this.piano(params);
    this.root.innerHTML = html;
    const kb = this.$<HTMLElement>('.kb');
    const keys = this.keys;
    if (this.skinName === 'pads')
      // Pads sit in a grid: the pad under the pointer, played harder toward its bottom.
      keys.layout = (x, y) => {
        const box = kb.getBoundingClientRect();
        const pad = (
          this.root.elementFromPoint(box.left + x, box.top + y) as HTMLElement | null
        )?.closest?.('[data-note]') as HTMLElement | null;
        if (!pad?.dataset.note) return null;
        const r = pad.getBoundingClientRect();
        return {
          note: Number(pad.dataset.note),
          velocity: velocityAt(r.height, box.top + y - r.top),
        };
      };
    else {
      const { start, octaves } = this.pianoRange(params);
      keys.layout = { low: start, high: start + 12 * octaves, width: 1, height: 1 };
    }
    this.stopListening?.();
    this.stopListening = listen(
      this,
      {
        fit: (width, height) => keys.fit(width, height),
        pointerDown: input => keys.pointerDown(input),
        pointerMove: input => keys.pointerMove(input),
        pointerUp: input => keys.pointerUp(input),
        releaseAll: () => keys.releaseAll(),
      },
      { target: kb },
    );
    this.setAttribute('role', 'application');
    this.setAttribute('aria-label', 'Keyboard: press keys to play notes');
    this.paint();
  }

  private pianoRange(params: Record<string, unknown>) {
    const start =
      typeof params.start === 'number'
        ? params.start
        : this.hasAttribute('start')
          ? this.num('start', 48)
          : 12 * (this.num('octave', 4) + 1);
    const octaves = Math.max(
      1,
      Math.min(8, typeof params.octaves === 'number' ? params.octaves : this.num('octaves', 2)),
    );
    return { start, octaves };
  }

  private piano(params: Record<string, unknown>): string {
    const { start, octaves } = this.pianoRange(params);
    const pc = this.hasAttribute('pc') ? this.num('pc', start) : null;
    const letter = (n: number) =>
      pc !== null && n >= pc && n <= pc + 12 ? 'AWSEDFTGYHUJK'[n - pc] : '';
    const whites: number[] = [],
      blacks: Array<{ note: number; at: number }> = [];
    for (let n = start, w = 0; n <= start + 12 * octaves; n++) {
      if ([1, 3, 6, 8, 10].includes(n % 12)) blacks.push({ note: n, at: w });
      else {
        whites.push(n);
        w++;
      }
    }
    const ww = 100 / whites.length;
    const label = (n: number) =>
      `${letter(n) ? `<span class="k">${letter(n)}</span>` : ''}${n % 12 === 0 ? `<span class="c">C${Math.floor(n / 12) - 1}</span>` : ''}`;
    const lit = col(params.lit, 'var(--dk-accent,#5ec4ff)');
    return `<style>${BASE_CSS}.kb{position:relative;width:100%;height:100%;user-select:none}.w,.b{position:absolute;top:0;border:1px solid var(--dk-key-line,#222);border-radius:0 0 4px 4px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:4px;gap:1px;font:600 10px/1 Lato,system-ui,sans-serif}.w{height:100%;background:var(--dk-key-white,#f3f3f3);color:var(--dk-key-label,#555)}.b{height:60%;background:var(--dk-key-black,#222);z-index:1;color:#bbb}.on{background:var(--dk-key-down,${lit})!important;color:var(--dk-key-down-label,#111)!important}.b.on{background:var(--dk-key-down-black,var(--dk-key-down,${lit}))!important}.k{font-size:11px}.c{font-weight:400;font-size:9px;color:#999}</style>
      <div class="kb" part="keyboard">${whites.map((n, i) => `<div class="w" data-note="${n}" style="left:${i * ww}%;width:${ww}%">${label(n)}</div>`).join('')}${blacks.map(b => `<div class="b" data-note="${b.note}" style="left:${b.at * ww - ww * 0.3}%;width:${ww * 0.6}%">${label(b.note)}</div>`).join('')}</div>`;
  }

  private pads(params: Record<string, unknown>): string {
    const count = Math.max(1, Math.min(32, this.p(params, 'count', 8))),
      columns = Math.max(1, Math.min(16, this.p(params, 'columns', 4)));
    const notes = padNotes(count, this.p(params, 'start', 48), this.p(params, 'scale', 'major'));
    const labels = this.p(params, 'labels', '')
      .split(',')
      .map(s => s.trim());
    const palette = this.p(params, 'colors', 'rainbow');
    const color = (i: number) =>
      palette === 'rainbow'
        ? `hsl(${Math.round((360 * i) / count)} 85% 58%)`
        : palette === 'pastel'
          ? `hsl(${Math.round((360 * i) / count)} 70% 80%)`
          : palette === 'accent' || palette === 'outline'
            ? 'var(--dk-accent)'
            : 'var(--dk-track)';
    const rows = Math.ceil(count / columns),
      gap = this.p(params, 'gap', 10),
      radius = this.p(params, 'radius', 14);
    return `<style>${BASE_CSS}
      .kb{display:grid;width:100%;height:100%;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},1fr);gap:${gap}px}
      .pad{position:relative;border-radius:${radius}px;background:var(--c);display:flex;align-items:flex-end;justify-content:flex-start;padding:6px 8px;color:color-mix(in srgb, var(--c) 30%, #000);font-weight:700;box-shadow:inset 0 -6px 0 color-mix(in srgb, var(--c) 70%, #000), 0 3px 6px #0005;transition:transform .05s, filter .05s;cursor:pointer;overflow:hidden}
      .pad span{pointer-events:none;font-family:var(--dk-label-font,var(--dk-font));font-size:var(--dk-label-size,13px);text-transform:var(--dk-label-case,none);letter-spacing:var(--dk-label-spacing,0)}
      .pad.on{transform:translateY(3px) scale(.98);filter:brightness(1.18);box-shadow:inset 0 -2px 0 color-mix(in srgb, var(--c) 70%, #000), 0 0 18px 2px var(--c)}
      .outline .pad{background:transparent;border:1.5px solid var(--c);color:var(--c);box-shadow:none}
      .outline .pad.on{background:var(--c);color:var(--dk-bg);box-shadow:0 0 14px 1px var(--c);transform:none;filter:none}
      </style><div class="kb${palette === 'outline' ? ' outline' : ''}" part="keyboard">${notes.map((n, i) => `<div class="pad" data-note="${n}" style="--c:${color(i)}"><span>${escapeHtml(labels[i] || noteName(n))}</span></div>`).join('')}</div>`;
  }

  protected paint() {
    const held = new Set([
      ...(this.getAttribute('held') ?? '').split(',').filter(Boolean).map(Number),
      ...this.keys.notes,
    ]);
    for (const key of this.root.querySelectorAll<HTMLElement>('[data-note]'))
      key.classList.toggle('on', held.has(Number(key.dataset.note)));
  }
}
