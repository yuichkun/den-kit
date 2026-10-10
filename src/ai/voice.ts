// Voice input for the AI bar: hold Space (or click the mic) and speak; release
// to send. Uses the browser's own speech recognition — in Chrome the audio is
// transcribed on Google's servers. Every failure becomes a short message; the
// editor never depends on it.
import { ref } from 'vue';
import { desktop } from '../desktop/api.ts';

/** The subset of SpeechRecognition the AI bar uses (tests pass a fake). */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type VoiceState = 'idle' | 'listening' | 'finishing';

export const VOICE_UNSUPPORTED = desktop()
  ? 'Voice input is not available in this desktop build. You can type your request instead.'
  : 'Voice input needs Chrome (this browser has no speech recognition).';
const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it from the icon at the left of the address bar, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow it from the icon at the left of the address bar, then try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition could not reach its server (Chrome transcribes speech online).',
  'language-not-supported': 'Speech recognition does not support this language.',
};
export const NOTHING_HEARD = 'Didn’t catch anything. Hold Space while you speak.';

/** The browser's recognizer, if there is one. */
export function browserRecognition(): (() => RecognitionLike) | null {
  // Electron exposes this API but cannot use Chrome's Google speech service.
  if (desktop()) return null;
  const w = globalThis as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? () => new Ctor() : null;
}

export interface VoiceOptions {
  /** null: no speech recognition in this browser. */
  create: (() => RecognitionLike) | null;
  onText: (text: string) => void;
  lang?: string;
  /** Shorter holds are taken as an accidental tap and ignored. */
  minHoldMs?: number;
  /** Stop listening on its own after this long. */
  maxMs?: number;
  /** Give up waiting for the recognizer's final answer after this long. */
  finishTimeoutMs?: number;
  now?: () => number;
}

export class VoiceInput {
  readonly state = ref<VoiceState>('idle');
  /** What has been heard so far (shown live in the AI bar). */
  readonly heard = ref('');
  readonly error = ref('');
  lang: string;
  private rec: RecognitionLike | null = null;
  private token = 0;
  private finalText = '';
  private interimText = '';
  private send = false;
  /** A recognizer error (blocked mic, no network…): this attempt never sends. */
  private failed = false;
  private startedAt = 0;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly options: Required<Omit<VoiceOptions, 'create' | 'lang'>> & Pick<VoiceOptions, 'create'>;

  constructor(options: VoiceOptions) {
    this.options = { minHoldMs: 250, maxMs: 15000, finishTimeoutMs: 4000, now: () => performance.now(), ...options };
    this.lang = options.lang ?? defaultLang();
  }

  get supported() { return !!this.options.create; }
  get active() { return this.state.value !== 'idle'; }

  /** Start listening. Returns false (with a message) when it cannot. */
  start(): boolean {
    if (this.active) return true;
    this.error.value = '';
    if (!this.options.create) { this.error.value = VOICE_UNSUPPORTED; return false; }
    const token = ++this.token;
    let rec: RecognitionLike;
    try { rec = this.options.create(); } catch { this.error.value = VOICE_UNSUPPORTED; return false; }
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.finalText = ''; this.interimText = ''; this.heard.value = ''; this.send = false; this.failed = false;
    rec.onresult = event => {
      if (token !== this.token) return;
      let final = '', interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i]!;
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      this.finalText = final; this.interimText = interim;
      this.heard.value = (final + interim).trim();
    };
    rec.onerror = event => {
      if (token !== this.token || event.error === 'aborted') return;
      if (event.error === 'no-speech') return; // reported on end if nothing was heard
      this.error.value = ERRORS[event.error] ?? `Speech recognition failed (${event.error}).`;
      this.failed = true;
    };
    rec.onend = () => { if (token === this.token) this.finish(); };
    try { rec.start(); }
    catch (error) { this.error.value = `Speech recognition could not start (${error instanceof Error ? error.message : String(error)}).`; return false; }
    this.rec = rec;
    this.state.value = 'listening';
    this.startedAt = this.options.now();
    this.timers.push(setTimeout(() => { if (token === this.token && this.state.value === 'listening') this.stop(); }, this.options.maxMs));
    return true;
  }

  /** Release: send what was heard. A tap shorter than minHoldMs is ignored. */
  stop() {
    if (this.state.value !== 'listening' || !this.rec) return;
    if (this.failed || this.options.now() - this.startedAt < this.options.minHoldMs) { this.cancel(); return; }
    this.send = true;
    this.state.value = 'finishing';
    const token = this.token;
    try { this.rec.stop(); } catch { this.finish(); return; }
    // If the recognizer never reports the end, use what was heard so far.
    this.timers.push(setTimeout(() => {
      if (token !== this.token || this.state.value !== 'finishing') return;
      const rec = this.rec;
      this.finish(); // first, so the abort's own "end" is ignored
      try { rec?.abort(); } catch { /* already stopped */ }
    }, this.options.finishTimeoutMs));
  }

  /** Stop without sending (window lost focus, Escape, a too-short tap). */
  cancel() {
    if (!this.rec) { this.state.value = 'idle'; return; }
    this.send = false;
    const rec = this.rec;
    this.token++; // ignore whatever the old recognizer still reports
    this.reset();
    try { rec.abort(); } catch { /* already stopped */ }
  }

  private finish() {
    const text = (this.finalText || this.interimText).trim();
    const send = this.send && !this.failed;
    this.token++;
    this.reset();
    if (!send) return;
    if (text) this.options.onText(text);
    else if (!this.error.value) this.error.value = NOTHING_HEARD;
  }

  private reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.rec = null;
    this.state.value = 'idle';
    this.heard.value = '';
  }
}

const LANG_KEY = 'den-kit:voice-lang';
export const VOICE_LANGS = { 'ja-JP': '日本語', 'en-US': 'English' } as const;

/** Japanese unless English was chosen in the drawer (English words like “reverb” still come through as リバーブ). */
function defaultLang() {
  try { const saved = globalThis.localStorage?.getItem(LANG_KEY); if (saved && saved in VOICE_LANGS) return saved; } catch { /* storage blocked */ }
  return 'ja-JP';
}

export function saveVoiceLang(lang: string) {
  try { globalThis.localStorage?.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
}
