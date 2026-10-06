// Stage 0: the lexicon recognises common English / Japanese phrasings, attaches
// amounts, and says when the whole request is understood (then Jev is skipped).
import { describe, expect, it } from 'vitest';
import { parseRequest, detectLanguage } from '../../../src/ai/lexicon.ts';

const one = (text: string) => { const r = parseRequest(text); expect(r.items, text).toHaveLength(1); return { ...r.items[0]!, full: r.full }; };

describe('lexicon', () => {
  it.each([
    ['明るく', 'brightness', 'up'], ['もっと明るくして', 'brightness', 'up'], ['こもらせて', 'brightness', 'down'], ['暗めにして', 'brightness', 'down'],
    ['フィルター開けて', 'brightness', 'up'], ['リリース長く', 'release', 'up'], ['リリースを短くしてください', 'release', 'down'], ['余韻を長く', 'release', 'up'],
    ['アタックを速く', 'attack', 'down'], ['アタックをゆっくりに', 'attack', 'up'], ['もっと揺らして', 'wobble', 'up'], ['揺れを小さく', 'wobble', 'down'],
    ['LFOを速く', 'rate', 'up'], ['レゾナンス上げて', 'resonance', 'up'], ['歪ませて', 'drive', 'up'], ['音量を下げて', 'volume', 'down'],
    ['ウェットに', 'mix', 'up'], ['レゾナンスを最大に', 'resonance', 'set_max'], ['リリースをゼロに', 'release', 'set_min'],
    ['brighter', 'brightness', 'up'], ['darker please', 'brightness', 'down'], ['longer release', 'release', 'up'], ['snappier', 'attack', 'down'],
    ['more wobble', 'wobble', 'up'], ['faster lfo', 'rate', 'up'], ['wetter', 'mix', 'up'], ['drier', 'mix', 'down'], ['more resonance', 'resonance', 'up'],
    ['dirtier', 'drive', 'up'], ['louder', 'volume', 'up'], ['more repeats', 'feedback', 'up'], ['more glide', 'glide', 'up'],
  ])('%s → %s %s', (text, aspect, direction) => {
    const item = one(text);
    expect(item).toMatchObject({ kind: 'adjust', aspect, direction });
    expect(item.full).toBe(true);
  });

  it('attaches amounts', () => {
    expect(one('少し明るく')).toMatchObject({ amount: 'small' });
    expect(one('ほんの少し暗く')).toMatchObject({ amount: 'tiny' });
    expect(one('かなりこもらせて')).toMatchObject({ amount: 'large' });
    expect(one('めちゃくちゃ明るく')).toMatchObject({ amount: 'extreme' });
    expect(one('a bit brighter')).toMatchObject({ amount: 'small' });
    expect(one('slightly darker')).toMatchObject({ amount: 'tiny' });
    expect(one('much brighter')).toMatchObject({ amount: 'large' });
    expect(one('brighter')).not.toHaveProperty('amount');
  });

  it('effects: add, more, less', () => {
    expect(one('リバーブ足して')).toMatchObject({ kind: 'fx', fx: 'reverb', verb: 'add' });
    expect(one('リバーブ多めで')).toMatchObject({ kind: 'fx', fx: 'reverb', verb: 'more' });
    expect(one('ディレイかけて')).toMatchObject({ kind: 'fx', fx: 'delay', verb: 'add' });
    expect(one('add some reverb')).toMatchObject({ kind: 'fx', fx: 'reverb', verb: 'add' });
    expect(one('less delay')).toMatchObject({ kind: 'fx', fx: 'delay', verb: 'less' });
    expect(one('add a ping-pong delay')).toMatchObject({ kind: 'fx', fx: 'pingpong' });
  });

  it('templates need a "make" verb; "more bass" is not a template', () => {
    expect(one('ベース作って')).toMatchObject({ kind: 'template', template: 'bass', full: true });
    expect(one('パッドを作ってください')).toMatchObject({ kind: 'template', template: 'pad' });
    expect(one('make a bass')).toMatchObject({ kind: 'template', template: 'bass', full: true });
    expect(one('give me a pluck sound')).toMatchObject({ kind: 'template', template: 'pluck' });
    const more = parseRequest('more bass');
    expect(more.items).toEqual([]);
    expect(more.full).toBe(false);
  });

  it('several intents in one request, with slots for templates', () => {
    const r = parseRequest('かなり暗くして、アタックを速く');
    expect(r.items.map(i => i.kind === 'adjust' && `${i.aspect}:${i.direction}:${i.amount ?? ''}`)).toEqual(['brightness:down:large', 'attack:down:']);
    expect(r.full).toBe(true);
    const t = parseRequest('make a dark pad');
    expect(t.items.map(i => i.kind)).toEqual(['adjust', 'template']);
    expect(parseRequest('明るいベースを作って').full).toBe(true);
  });

  it('is not full when something meaningful is left over (Jev decides)', () => {
    expect(parseRequest('make it sound like a spaceship').full).toBe(false);
    expect(parseRequest('brighter like a trumpet').full).toBe(false);
    expect(parseRequest('明るくして、宇宙っぽく').full).toBe(false);
    expect(parseRequest('').full).toBe(false);
    expect(parseRequest('remove the delay').items).toEqual([]);
  });

  it('normalises width and case and detects the language', () => {
    expect(one('ＢＲＩＧＨＴＥＲ')).toMatchObject({ aspect: 'brightness' });
    expect(detectLanguage('明るく')).toBe('ja');
    expect(detectLanguage('brighter')).toBe('en');
  });
});
