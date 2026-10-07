// Fast screen edits: the words for them (Japanese and English), when "darker"
// means the screen rather than the sound, and what each one changes. Applied
// through the fast path, a screen edit is one ai-fast step that ⌘Z takes back.
import { beforeEach, describe, expect, it } from 'vitest';
import { catalog } from '../../../src/blocks/index.ts';
import { parseRequest } from '../../../src/ai/lexicon.ts';
import { planLook, shiftLightness } from '../../../src/ai/look-intents.ts';
import { lexiconStage } from '../../../src/ai/router.ts';
import { FastPath } from '../../../src/ai/fast-path.ts';
import { applyIntents } from '../../../src/core/ops.ts';
import { clone } from '../../../src/core/schema.ts';
import { starter } from '../../../src/core/starters.ts';
import { findWork } from '../../../src/showcase/index.ts';
import { testSession, stubBridge } from '../../helpers/fake-bridge.ts';
import { scriptedAnswerer } from '../../fakes/jev/scripted.ts';
import type { KitSession } from '../../../src/editor/session.ts';

const looks = (text: string, screen = false) => { const r = parseRequest(text, { screen }); return { items: r.items.map(i => i.kind === 'look' ? { ...i.change, amount: i.amount } : { kind: i.kind }), full: r.full }; };

describe('the words for screen edits', () => {
  it.each([
    ['画面を暗くして', { kind: 'tone', direction: 'darker' }],
    ['見た目をもっと明るく', { kind: 'tone', direction: 'lighter' }],
    ['アクセントを赤に', { kind: 'accent', name: 'red' }],
    ['差し色を水色にして', { kind: 'accent', name: 'cyan' }],
    ['青っぽくして', { kind: 'accent', name: 'blue' }],
    ['蛍光グリーン基調に', { kind: 'accent', name: 'neon green' }],
    ['make the accent pink', { kind: 'accent', name: 'pink' }],
    ['orange accents please', { kind: 'accent', name: 'orange' }],
    ['文字を大きく', { kind: 'text', direction: 'bigger' }],
    ['ラベルを小さくして', { kind: 'text', direction: 'smaller' }],
    ['bigger text', { kind: 'text', direction: 'bigger' }],
    ['フォントを手書きにして', { kind: 'font', font: 'caveat' }],
    ['monospace font', { kind: 'font', font: 'jetbrains-mono' }],
    ['角を丸くして', { kind: 'corners', direction: 'rounder' }],
    ['sharper corners', { kind: 'corners', direction: 'squarer' }],
    ['ネオンっぽい見た目にして', { kind: 'wear', work: 'neon' }],
    ['木目のデザインで', { kind: 'wear', work: 'musicbox' }],
    ['make it look like a tape machine', { kind: 'wear', work: 'tapeecho' }],
    ['a neon look', { kind: 'wear', work: 'neon' }],
    ['ダークモードにして', { kind: 'tone', direction: 'darker' }],
  ])('%s', (text, change) => {
    const r = looks(text);
    expect(r.items).toEqual([expect.objectContaining(change)]);
    expect(r.full).toBe(true);
  });

  it('"darker" is the sound unless the request names the screen or the screen is being edited', () => {
    expect(parseRequest('暗くして').items).toEqual([expect.objectContaining({ kind: 'adjust', aspect: 'brightness', direction: 'down' })]);
    expect(looks('暗くして', true).items).toEqual([expect.objectContaining({ kind: 'tone', direction: 'darker' })]);
    expect(looks('darker', true).items).toEqual([expect.objectContaining({ kind: 'tone', direction: 'darker' })]);
    expect(parseRequest('音色を明るく').items).toEqual([expect.objectContaining({ kind: 'adjust', aspect: 'brightness' })]);
    // Looks named without a look word only when the screen is meant; "more space" stays a reverb.
    expect(parseRequest('宇宙っぽく').items.some(i => i.kind === 'look')).toBe(false);
    expect(looks('宇宙っぽく', true).items).toEqual([expect.objectContaining({ kind: 'wear', work: 'space' })]);
    expect(parseRequest('more space').items).toEqual([expect.objectContaining({ kind: 'fx', fx: 'reverb' })]);
    // Screen words are whole words: "guitar" has no "ui" in it ("UIを暗く" does).
    expect(parseRequest('make a guitar pedal sound').items.some(i => i.kind === 'look')).toBe(false);
    expect(parseRequest('make a guitar pedal sound').screen).toBe(false);
    expect(looks('UIを暗くして').items).toEqual([expect.objectContaining({ kind: 'tone', direction: 'darker' })]);
    // "丸く" alone is a mellower sound; "角を丸く" is the screen.
    expect(parseRequest('丸くして').items).toEqual([expect.objectContaining({ kind: 'adjust', aspect: 'brightness', direction: 'down' })]);
  });

  it('amounts and several edits at once', () => {
    expect(looks('文字をかなり大きく').items[0]).toMatchObject({ kind: 'text', amount: 'large' });
    expect(looks('画面を少し暗く').items[0]).toMatchObject({ kind: 'tone', amount: 'small' });
    expect(looks('アクセントを赤にして、文字を大きく').items).toEqual([expect.objectContaining({ kind: 'accent' }), expect.objectContaining({ kind: 'text' })]);
  });
});

describe('what each screen edit changes', () => {
  const work = (id: string) => findWork(id)!.build(catalog);
  const apply = (doc: ReturnType<typeof work>, plan: { intents?: unknown[] } & object) => applyIntents(doc, (plan as { intents: never[] }).intents, catalog).doc;

  it('accent: the accent and every token that was the same colour', () => {
    const doc = work('space'); // accent = pointer = #8f7bff
    const r = planLook(doc, catalog, { kind: 'accent', color: '#ff4d4d', name: 'red' });
    if (!r.ok) throw new Error(r.message);
    const after = apply(doc, r.plan);
    expect(after.ui.look.tokens).toMatchObject({ accent: '#ff4d4d', pointer: '#ff4d4d', glow: '#5ad1ff' });
    expect(r.plan.label).toBe('accent colour → red');
  });

  it('darker: the background colour, and one tint over the pictures that grows (never a pile of them)', () => {
    let doc = work('pad');
    const layers = doc.ui.look.background!.length;
    for (let i = 0; i < 2; i++) { const r = planLook(doc, catalog, { kind: 'tone', direction: 'darker' }); if (!r.ok) throw new Error(r.message); doc = apply(doc, r.plan); }
    expect(doc.ui.look.background).toHaveLength(layers + 1);
    expect(doc.ui.look.background!.at(-1)).toEqual({ kind: 'color', color: '#000000', opacity: 0.48 });
    expect(doc.ui.look.tokens.bg).toBe(shiftLightness(shiftLightness('#2b1a3a', -0.12)!, -0.12));
    // Lighter takes the tint back down; again, and it is gone.
    for (let i = 0; i < 2; i++) { const r = planLook(doc, catalog, { kind: 'tone', direction: 'lighter' }); if (!r.ok) throw new Error(r.message); doc = apply(doc, r.plan); }
    expect(doc.ui.look.background).toHaveLength(layers);
  });

  it('darker on a light screen says when the text stops reading', () => {
    const doc = applyIntents(starter('bass', catalog), [{ op: 'setTheme', theme: 'paper' }], catalog).doc;
    const r = planLook(doc, catalog, { kind: 'tone', direction: 'darker' }, 'extreme');
    expect(r.ok && r.plan.label).toBe('darker screen');
    let d = doc;
    for (let i = 0; i < 3; i++) { const x = planLook(d, catalog, { kind: 'tone', direction: 'darker' }, 'extreme'); if (!x.ok) throw new Error(x.message); d = apply(d, x.plan); if (/contrast/.test(x.plan.label)) return; }
    throw new Error('expected a contrast note');
  });

  it('bigger text: every text and its box, every control label', () => {
    const doc = work('space');
    const r = planLook(doc, catalog, { kind: 'text', direction: 'bigger' }, 'medium');
    if (!r.ok) throw new Error(r.message);
    const after = apply(doc, r.plan);
    const title = Object.values(after.ui.elements).find(e => e.kind === 'text' && e.text === 'NEBULA') as { textStyle: { size: number }; rect: { x: number; w: number } };
    expect(title.textStyle.size).toBe(54.5);
    expect(title.rect.w).toBeGreaterThan(720);
    expect(after.nodes.ktime!.style!.textStyle!.size).toBe(13);
    expect(after.nodes.ktime!.style!.skin).toEqual(doc.nodes.ktime!.style!.skin);
  });

  it('font: the look\'s fonts and every text\'s', () => {
    const doc = work('acid');
    const r = planLook(doc, catalog, { kind: 'font', font: 'caveat' });
    if (!r.ok) throw new Error(r.message);
    const after = apply(doc, r.plan);
    expect(after.ui.look.tokens).toMatchObject({ font: 'caveat', labelFont: 'caveat', valueFont: 'caveat' });
    for (const el of Object.values(after.ui.elements)) if (el.kind === 'text' && el.textStyle?.font) expect(el.textStyle.font).toBe('caveat');
  });

  it('rounder corners: boxes and skins with a corner radius; a look worn from a work', () => {
    const doc = work('toy');
    const r = planLook(doc, catalog, { kind: 'corners', direction: 'rounder' });
    if (!r.ok) throw new Error(r.message);
    expect((r.plan as { intents: unknown[] }).intents.length).toBeGreaterThan(0);
    const after = apply(doc, r.plan);
    const pads = Object.values(doc.nodes).find(n => n.type === 'ui.keyboard')!.id;
    expect(Number(after.nodes[pads]!.style!.skin!.params!.radius)).toBeGreaterThan(Number(doc.nodes[pads]!.style!.skin!.params!.radius));
    const wear = planLook(starter('bass', catalog), catalog, { kind: 'wear', work: 'neon' });
    if (!wear.ok) throw new Error(wear.message);
    expect(apply(starter('bass', catalog), wear.plan).ui.look.tokens.accent).toBe(work('neon').ui.look.tokens.accent);
  });

  it('the router applies a screen edit from the words alone (no Jev)', () => {
    const stage = lexiconStage(parseRequest('画面を暗くして'), { doc: work('pad'), catalog, selection: [] });
    expect(stage).toMatchObject({ kind: 'decided', decision: { kind: 'apply', plan: { kind: 'look', change: 'tone' } } });
  });
});

describe('through the fast path', () => {
  let session: KitSession;
  let fast: FastPath;
  beforeEach(() => {
    session = testSession();
    session.loadWork(findWork('space')!);
    session.bridge = stubBridge(scriptedAnswerer({})).bridge;
    fast = new FastPath(session);
  });

  it('one ai-fast step; ⌘Z restores the exact screen', async () => {
    const before = JSON.stringify({ ...clone(session.doc.value), revision: 0 });
    const o = await fast.run('アクセントを赤にして、文字を少し大きく');
    expect(o).toMatchObject({ status: 'applied', route: 'lexicon' });
    expect(o.label).toMatch(/accent colour → red \+ text bigger/);
    expect(session.doc.value.ui.look.tokens.accent).toBe('#ff4d4d');
    expect(session.history.peek()!.author).toMatchObject({ kind: 'ai-fast' });
    session.undo();
    expect(JSON.stringify({ ...clone(session.doc.value), revision: 0 })).toBe(before);
  });

  it('while the screen is being edited, "darker" darkens the screen; otherwise the sound', async () => {
    const bg = session.doc.value.ui.look.tokens.bg;
    session.screenFocus.value = true;
    await fast.run('もう少し暗く');
    expect(session.doc.value.ui.look.tokens.bg).not.toBe(bg);
  });
});
