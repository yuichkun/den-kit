// Voice input state machine against a fake recognizer: hold-to-talk sends once,
// taps and errors never send, and a late or stale recognizer cannot leak text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceInput, VOICE_UNSUPPORTED, NOTHING_HEARD, type RecognitionLike } from '../../../src/ai/voice.ts';

class FakeRecognition implements RecognitionLike {
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
  onresult: RecognitionLike['onresult'] = null;
  onerror: RecognitionLike['onerror'] = null;
  onend: RecognitionLike['onend'] = null;
  started = 0; stopped = 0; aborted = 0;
  private results: Array<{ isFinal: boolean; 0: { transcript: string } }> = [];
  start() { this.started++; }
  stop() { this.stopped++; }
  abort() { this.aborted++; this.onerror?.({ error: 'aborted' }); this.onend?.(); }
  hear(transcript: string, isFinal = false) {
    const last = this.results.at(-1);
    if (last && !last.isFinal) this.results.pop();
    this.results.push({ isFinal, 0: { transcript } });
    this.onresult?.({ resultIndex: 0, results: this.results });
  }
  end() { this.onend?.(); }
}

let clock = 0;
const recs: FakeRecognition[] = [];
function voice(extra: Partial<ConstructorParameters<typeof VoiceInput>[0]> = {}) {
  const sent: string[] = [];
  const v = new VoiceInput({ create: () => { const r = new FakeRecognition(); recs.push(r); return r; }, onText: t => sent.push(t), now: () => clock, lang: 'ja-JP', ...extra });
  return { v, sent, rec: () => recs.at(-1)! };
}
afterEach(() => { recs.length = 0; clock = 0; vi.useRealTimers(); });

describe('VoiceInput', () => {
  it('hold → speak → release sends the final transcript once', () => {
    const { v, sent, rec } = voice();
    expect(v.start()).toBe(true);
    expect(v.state.value).toBe('listening');
    expect(rec()).toMatchObject({ lang: 'ja-JP', continuous: true, interimResults: true });
    rec().hear('明る');
    expect(v.heard.value).toBe('明る');
    clock = 900;
    v.stop();
    expect(v.state.value).toBe('finishing');
    expect(rec().stopped).toBe(1);
    rec().hear('明るく', true);
    rec().end();
    expect(sent).toEqual(['明るく']);
    expect(v.state.value).toBe('idle');
    rec().end();
    expect(sent).toHaveLength(1);
  });

  it('uses the interim text when no final result arrives', () => {
    const { v, sent, rec } = voice();
    v.start(); rec().hear('リリース長く'); clock = 600; v.stop(); rec().end();
    expect(sent).toEqual(['リリース長く']);
  });

  it('a tap shorter than the minimum hold sends nothing', () => {
    const { v, sent, rec } = voice();
    v.start(); rec().hear('あ'); clock = 100; v.stop();
    expect(rec().aborted).toBe(1);
    expect(v.state.value).toBe('idle');
    expect(sent).toEqual([]);
    expect(v.error.value).toBe('');
  });

  it('nothing heard: a message, no text', () => {
    const { v, sent, rec } = voice();
    v.start(); clock = 800; v.stop(); rec().onerror?.({ error: 'no-speech' }); rec().end();
    expect(sent).toEqual([]);
    expect(v.error.value).toBe(NOTHING_HEARD);
  });

  it.each([['not-allowed', /blocked/], ['audio-capture', /No microphone/], ['network', /server/], ['something-new', /something-new/]])('error %s is reported and nothing is sent', (code, message) => {
    const { v, sent, rec } = voice();
    v.start(); rec().hear('明るく'); rec().onerror?.({ error: code }); clock = 800; v.stop(); rec().hear('明るく', true); rec().end();
    expect(sent).toEqual([]);
    expect(v.error.value).toMatch(message);
    expect(v.state.value).toBe('idle');
  });

  it('cancel (Escape / window blur) sends nothing, and the old recognizer cannot send later', () => {
    const { v, sent } = voice();
    v.start(); const old = recs.at(-1)!; old.hear('明るく');
    v.cancel();
    expect(old.aborted).toBe(1);
    v.start(); const fresh = recs.at(-1)!;
    old.hear('暗く', true); old.end();
    expect(sent).toEqual([]);
    expect(v.state.value).toBe('listening');
    fresh.hear('リバーブ足して', true); clock = 1000; v.stop(); fresh.end();
    expect(sent).toEqual(['リバーブ足して']);
  });

  it('stops on its own after the maximum time and sends what it heard', () => {
    vi.useFakeTimers();
    const { v, sent, rec } = voice({ maxMs: 2000 });
    v.start(); rec().hear('もっと揺らして'); clock = 2000;
    vi.advanceTimersByTime(2000);
    expect(rec().stopped).toBe(1);
    rec().end();
    expect(sent).toEqual(['もっと揺らして']);
  });

  it('a recognizer that never ends is given up on, keeping what was heard', () => {
    vi.useFakeTimers();
    const { v, sent, rec } = voice({ finishTimeoutMs: 1000 });
    v.start(); rec().hear('明るく'); clock = 800; v.stop();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(['明るく']);
    expect(v.state.value).toBe('idle');
  });

  it('without speech recognition it explains and never throws', () => {
    const v = new VoiceInput({ create: null, onText: () => { throw new Error('no'); } });
    expect(v.supported).toBe(false);
    expect(v.start()).toBe(false);
    expect(v.error.value).toBe(VOICE_UNSUPPORTED);
    v.stop(); v.cancel();
    expect(v.state.value).toBe('idle');
  });

  it('a recognizer that throws on start is reported', () => {
    const v = new VoiceInput({ create: () => { const r = new FakeRecognition(); r.start = () => { throw new Error('busy'); }; return r; }, onText: () => {} });
    expect(v.start()).toBe(false);
    expect(v.error.value).toMatch(/could not start/);
    expect(v.state.value).toBe('idle');
  });
});
