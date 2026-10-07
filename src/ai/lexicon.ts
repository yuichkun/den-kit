// Stage 0 of the fast path: common English and Japanese phrasings mapped
// straight to intents, with no network round trip. It also covers for Jev's
// weaker Japanese. When the lexicon accounts for the whole request, Jev is not
// called at all; otherwise its matches become hints and fallbacks.
import type { Amount, Direction, FxId } from './intents.ts';
import { ACCENTS, LOOK_WORDS, type LookChange } from './look-intents.ts';
import type { TemplateId } from './templates.ts';

export type LexItem =
  | { kind: 'adjust'; aspect: string; direction: Direction; amount?: Amount; phrase: string }
  | { kind: 'fx'; fx: FxId; verb: 'add' | 'more' | 'less'; amount?: Amount; phrase: string }
  | { kind: 'template'; template: TemplateId; phrase: string }
  /** A change of the plugin screen (colours, text size, font, corners, a look). */
  | { kind: 'look'; change: LookChange; amount?: Amount; phrase: string }
  /** Needs the LLM (code, wiring, explanations): never guessed by the fast path. */
  | { kind: 'complex'; phrase: string };

export interface LexResult {
  items: LexItem[];
  /** The request is about the screen (it says so, or the person is editing the plugin). */
  screen: boolean;
  /** True when nothing meaningful is left after the matches and filler words. */
  full: boolean;
  leftover: string;
  lang: 'ja' | 'en';
}

type Rule = { re: RegExp; item: (m: RegExpExecArray) => LexItem };
const adj = (aspect: string, direction: Direction) => (m: RegExpExecArray): LexItem => ({ kind: 'adjust', aspect, direction, phrase: m[0] });
const fx = (f: FxId, verb: 'add' | 'more' | 'less') => (m: RegExpExecArray): LexItem => ({ kind: 'fx', fx: f, verb, phrase: m[0] });

// Japanese verb stems for "increase/longer/stronger" and the opposite.
const JA_UP = '(?:上げ|あげ|強[くめ]|強化|増[やし]|多[くめ]|大き[くめ]|深[くめ]|長[くめ]|伸ば|足し|足して|プラス)';
const JA_DOWN = '(?:下げ|さげ|弱[くめ]|減ら|少な[くめ]|小さ[くめ]|浅[くめ]|短[くめ]|抑え|控えめ|なくし|無くし|切っ|カット)';
const O = '(?:を|は|が|の)?\\s*(?:もっと|もう少し|少し|ちょっと|かなり|やや)?\\s*';

const JA_FX: Array<[FxId, string]> = [['reverb', 'リバーブ|残響|ホール感|響き'], ['pingpong', 'ピンポン(?:ディレイ)?'], ['delay', 'ディレイ|エコー|やまびこ'], ['chorus', 'コーラス'], ['phaser', 'フェイザー'], ['flanger', 'フランジャー'], ['compressor', 'コンプ(?:レッサー)?'], ['drive', 'ディストーション|オーバードライブ|ファズ']];
const EN_FX: Array<[FxId, string]> = [['reverb', 'reverb|room|hall|space'], ['pingpong', 'ping[- ]?pong(?: delay)?'], ['delay', 'delay|echo(?:es)?'], ['chorus', 'chorus'], ['phaser', 'phaser'], ['flanger', 'flanger'], ['compressor', 'compressor|compression'], ['drive', 'distortion|overdrive|fuzz']];
const JA_TEMPLATES: Array<[TemplateId, string]> = [['bass', 'ベース'], ['pad', 'パッド'], ['lead', 'リード'], ['pluck', 'プラック|ピチカート'], ['keys', 'キーズ|鍵盤|エレピ|ピアノ'], ['perc', 'パーカッション|ドラム|キック|打楽器']];
const EN_TEMPLATES: Array<[TemplateId, string]> = [['bass', 'bass(?:line)?'], ['pad', 'pad'], ['lead', 'lead'], ['pluck', 'pluck'], ['keys', 'keys|piano|e-?piano'], ['perc', 'perc(?:ussion)?|drums?|kick']];

const JA_NOUNS: Array<[string, string]> = [['resonance', 'レゾナンス|レゾ'], ['attack', 'アタック'], ['decay', 'ディケイ|ディケー'], ['sustain', 'サステイン|サスティン|サステン'], ['release', 'リリース|余韻'], ['feedback', 'フィードバック|リピート'], ['mix', 'ウェット|エフェクト'], ['drive', '歪み|ドライブ'], ['glide', 'グライド|ポルタメント'], ['volume', '音量|ボリューム'], ['brightness', 'カットオフ|フィルター|フィルタ'], ['wobble', '揺れ|ビブラート|トレモロ']];

// ---- the plugin screen ----------------------------------------------------------------------------
/** Words that say the request is about the screen ("色" but not "音色"). */
const SCREEN_WORDS = /画面|見た目|ルック|デザイン|背景|テーマ|スキン|(?<!音)色|カラー|フォント|書体|文字|ラベル|パネル|\b(?:screen|look|looks|ui|gui|interface|design|background|theme|skin|colou?rs?|font|fonts|text|labels?|panel|layout|visuals?|appearance)\b/;
const look = (change: (m: RegExpExecArray) => LookChange) => (m: RegExpExecArray): LexItem => ({ kind: 'look', change: change(m), phrase: m[0] });
const JA_COLORS: Array<[string, string]> = [['neon green', '蛍光グリーン|蛍光緑'], ['lime', '黄緑|ライム'], ['teal', '青緑|ティール'], ['cyan', '水色|シアン|空色'], ['yellow', '黄色|黄|イエロー'], ['red', '赤|レッド'], ['orange', 'オレンジ|橙'], ['gold', '金|ゴールド'], ['green', '緑|グリーン'], ['blue', '青|ブルー'], ['purple', '紫|パープル'], ['pink', 'ピンク|桃色'], ['magenta', 'マゼンタ'], ['white', 'ホワイト'], ['silver', '銀|シルバー']];
const EN_COLORS: Array<[string, string]> = [['neon green', 'neon green'], ['lime', 'lime'], ['teal', 'teal'], ['cyan', 'cyan|turquoise|aqua'], ['yellow', 'yellow'], ['red', 'red'], ['orange', 'orange'], ['gold', 'gold(?:en)?'], ['green', 'green'], ['blue', 'blue'], ['purple', 'purple|violet'], ['pink', 'pink'], ['magenta', 'magenta'], ['white', 'white'], ['silver', 'silver']];
const JA_COLOR = JA_COLORS.map(([, w]) => w).join('|'), EN_COLOR = EN_COLORS.map(([, w]) => w).join('|');
const colorKey = (word: string) => (JA_COLORS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)) ?? EN_COLORS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)))?.[0] ?? 'red';
const accent = (word: string): LookChange => { const key = colorKey(word); return { kind: 'accent', color: ACCENTS[key]!, name: key }; };
const JA_FONTS: Array<[string, string]> = [['caveat', '手書き|手描き'], ['kalam', 'マーカー'], ['serif', '明朝|セリフ'], ['playfair-display', 'エレガント|上品'], ['jetbrains-mono', '等幅|モノスペース'], ['fredoka', '丸文字|丸ゴシック|丸ゴ|丸い'], ['orbitron', '近未来|sf|サイファイ'], ['saira-stencil-one', 'ステンシル'], ['courier-prime', 'タイプライター'], ['lato', 'ゴシック|サンセリフ'], ['cinzel', '刻印|クラシック'], ['oswald', 'コンデンス|細長い']];
const EN_FONTS: Array<[string, string]> = [['caveat', 'handwritten|handwriting|hand-?drawn'], ['kalam', 'marker'], ['serif', 'serif'], ['playfair-display', 'elegant'], ['jetbrains-mono', 'monospaced|monospace|mono|code'], ['fredoka', 'rounded|round'], ['orbitron', 'sci-?fi|futuristic|space-?age'], ['saira-stencil-one', 'stencil(?:led)?'], ['courier-prime', 'typewriter'], ['lato', 'sans(?:-serif)?|clean'], ['cinzel', 'engraved|classical|roman'], ['oswald', 'condensed']];
const fontOf = (word: string) => (JA_FONTS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)) ?? EN_FONTS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)))?.[0] ?? 'lato';
const JA_LOOKS: Array<[string, string]> = [['neon', 'ネオン'], ['sunset', '夕焼け|夕暮れ|サンセット'], ['wood', '木目|木箱|オルゴール|真鍮|アンティーク'], ['space', '宇宙|星空|銀河'], ['tape', 'テープエコー|テープ|オープンリール'], ['cassette', 'カセット'], ['pedal', 'コンパクトエフェクター|エフェクター|ペダル'], ['toy', 'おもちゃ|カラフル|ポップ'], ['lab', '計測器|測定器|オシロ'], ['acid', 'アシッド|蛍光']];
const EN_LOOKS: Array<[string, string]> = [['neon', 'neon(?: sign)?'], ['sunset', 'sunset'], ['wood', 'wood(?:en)?|brass|music ?box|antique'], ['space', 'space|starry|galaxy|cosmic'], ['tape', 'tape(?: machine| echo)?|reel(?:-to-reel)?'], ['cassette', 'cassette'], ['pedal', '(?:guitar )?pedal|stomp ?box'], ['toy', 'toy|playful|colou?rful'], ['lab', 'lab|measuring|scientific|oscilloscope'], ['acid', 'acid']];
const lookOf = (word: string): LookChange => { const key = (JA_LOOKS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)) ?? EN_LOOKS.find(([, w]) => new RegExp(`^(?:${w})$`).test(word)))?.[0] ?? 'neon'; return { kind: 'wear', work: LOOK_WORDS[key]! }; };
const JA_LOOK = JA_LOOKS.map(([, w]) => w).join('|'), EN_LOOK = EN_LOOKS.map(([, w]) => w).join('|');
const TEXT_JA = '(?:文字|字|テキスト|ラベル|フォント(?:サイズ)?)(?:の(?:サイズ|大きさ))?(?:を|が|は)?\\s*(?:もっと|もう少し|少し|ちょっと|かなり)?\\s*';
const TEXT_EN = '(?:text|labels?|fonts?|letters|type|writing|lettering)';

/** Screen edits any request may ask for: colours, text size, fonts, corners, a look named with a look word. */
const SCREEN_RULES: Rule[] = [
  { re: new RegExp(`(${JA_LOOK})(?:っぽい|風の?|みたいな|調の?|ぽい|な|の)?\\s*(?:見た目|デザイン|画面|ルック|雰囲気|スキン|テーマ|ui\\b)(?:に|で)?`, 'g'), item: look(m => lookOf(m[1]!)) },
  { re: new RegExp(`\\b(${EN_LOOK}) (?:look|style|theme|skin|design|ui|vibe)\\b|\\blooks? like (?:a |an )?(${EN_LOOK})\\b`, 'g'), item: look(m => lookOf(m[1] ?? m[2]!)) },
  { re: new RegExp(`${TEXT_JA}(?:大きく|でかく|拡大)`, 'g'), item: look(() => ({ kind: 'text', direction: 'bigger' })) },
  { re: new RegExp(`${TEXT_JA}(?:小さく|縮小)`, 'g'), item: look(() => ({ kind: 'text', direction: 'smaller' })) },
  { re: new RegExp(`\\b(?:bigger|larger|huger|enlarge(?: the)?) ${TEXT_EN}\\b|\\b${TEXT_EN} (?:bigger|larger)\\b`, 'g'), item: look(() => ({ kind: 'text', direction: 'bigger' })) },
  { re: new RegExp(`\\b(?:smaller|tinier|shrink(?: the)?) ${TEXT_EN}\\b|\\b${TEXT_EN} smaller\\b`, 'g'), item: look(() => ({ kind: 'text', direction: 'smaller' })) },
  { re: new RegExp(`(?:フォント|書体|文字|字)(?:を|は)?\\s*(${JA_FONTS.map(([, w]) => w).join('|')})(?:風|っぽく|に|の(?:フォント|書体)?|で)?|(${JA_FONTS.map(([, w]) => w).join('|')})(?:風の|っぽい|の)?(?:フォント|書体|文字)(?:に|で)?`, 'g'), item: look(m => ({ kind: 'font', font: fontOf(m[1] ?? m[2]!) })) },
  { re: new RegExp(`\\b(${EN_FONTS.map(([, w]) => w).join('|')}) (?:font|fonts|text|lettering|type|typeface|letters)\\b|\\b(?:font|typeface|lettering) (?:to |in |=)?(?:a |an )?(${EN_FONTS.map(([, w]) => w).join('|')})\\b`, 'g'), item: look(m => ({ kind: 'font', font: fontOf(m[1] ?? m[2]!) })) },
  { re: /角(?:を|が)?\s*(?:もっと|少し)?\s*(?:丸く|丸め)|角丸に|丸みを(?:つけ|付け|足し)|\b(?:rounder|round(?:ed)?|softer) (?:corners|edges)\b|\bround (?:the |off the )?corners\b/g, item: look(() => ({ kind: 'corners', direction: 'rounder' })) },
  { re: /角(?:を|が)?\s*(?:尖らせ|立て|四角く|シャープに)|四角っぽく|\b(?:square|squarer|sharp|sharper|hard) (?:corners|edges)\b/g, item: look(() => ({ kind: 'corners', direction: 'squarer' })) },
  { re: new RegExp(`(?:アクセント(?:カラー|色)?|差し色|メイン(?:カラー|の色)|テーマ(?:カラー|色)|キーカラー|(?<!音)色)(?:を|は|が)?\\s*(?:もっと)?\\s*(${JA_COLOR})(?:色)?(?:に|へ|っぽく|系に|系)?`, 'g'), item: look(m => accent(m[1]!)) },
  { re: new RegExp(`(${JA_COLOR})(?:色)?(?:っぽく|系に|基調に|ベースに|を基調|をアクセント|のアクセント)`, 'g'), item: look(m => accent(m[1]!)) },
  { re: /(赤|青|黄色)く(?:して|する)?/g, item: look(m => accent(m[1]!)) },
  { re: new RegExp(`\\b(${EN_COLOR}) (?:accents?|highlights?|colou?r ?scheme|theme)\\b|\\b(?:accent|highlight|main) ?colou?rs? (?:to |in |into |=)?(?:be )?(?:a |an )?(${EN_COLOR})\\b|\\baccents? (?:in |to )?(${EN_COLOR})\\b|\\b(?:make|turn|paint) it (${EN_COLOR})\\b`, 'g'), item: look(m => accent(m[1] ?? m[2] ?? m[3] ?? m[4]!)) },
  { re: /黒(?:っぽく|く|基調に|ベースに)|ダークモード|ダークテーマ|\bdark (?:mode|theme)\b/g, item: (m: RegExpExecArray): LexItem => ({ kind: 'look', change: { kind: 'tone', direction: 'darker' }, amount: /モード|テーマ|mode|theme/.test(m[0]) ? 'extreme' : 'large', phrase: m[0] }) },
  { re: /白(?:っぽく|く|基調に|ベースに)|ライトモード|ライトテーマ|\blight (?:mode|theme)\b/g, item: (m: RegExpExecArray): LexItem => ({ kind: 'look', change: { kind: 'tone', direction: 'lighter' }, amount: /モード|テーマ|mode|theme/.test(m[0]) ? 'extreme' : 'large', phrase: m[0] }) },
];
/** Words that mean the screen only when the request is about it ("暗く" is a darker sound otherwise). */
const SCREEN_CONTEXT_RULES: Rule[] = [
  { re: new RegExp(`(${JA_LOOK})(?:っぽく|風に|みたいに|調に|にして)`, 'g'), item: look(m => lookOf(m[1]!)) },
  { re: new RegExp(`\\b(${EN_LOOK})(?:-?ish| style)?\\b`, 'g'), item: look(m => lookOf(m[1]!)) },
  { re: /暗[くいめ]|ダークに|シックに|渋く|落ち着いた色に|\bdark(?:er|en)?\b/g, item: look(() => ({ kind: 'tone', direction: 'darker' })) },
  { re: /明る[くいめ]|爽やかに|ライトに|\b(?:light(?:er|en)?|brighter)\b/g, item: look(() => ({ kind: 'tone', direction: 'lighter' })) },
  { re: /丸く|\brounder\b/g, item: look(() => ({ kind: 'corners', direction: 'rounder' })) },
  { re: new RegExp(`(${JA_COLOR})(?:に|で)|\\b(${EN_COLOR})\\b`, 'g'), item: look(m => accent(m[1] ?? m[2]!)) },
];
/** Screen nouns that carry nothing once a screen edit is recognised ("画面を", "the look"). */
const SCREEN_FILLER = /画面|見た目|ルック|デザイン|背景|テーマ|スキン|(?<!音)色|カラー|全体|プラグイン|\b(?:screen|look|looks|ui|gui|interface|design|background|theme|skin|colou?rs?|plugin|visuals?|appearance)\b/g;

// Order matters: longer / more specific rules first; matches never overlap.
const COMPLEX: Rule =
  // ---- requests that need the LLM path. ("コード" alone also means "chord", so only code-ish phrasings.)
  { re: /コードボックス|コードで|コードを(?:書|作)|スクリプト|プログラム|説明|仕組み|教えて|なぜ|どうして|ルーティング|配線|(?:つな|繋)(?:い|げ)|接続|\b(?:codebox|code|script|program|write|explain|why|how does|what does|route|wire|connect|modulate the)\b/g, item: m => ({ kind: 'complex', phrase: m[0] }) };
const RULES: Rule[] = [
  // ---- template nouns (kept only when a "make/作って" verb is also present; see parseRequest)
  ...JA_TEMPLATES.map(([t, w]): Rule => ({ re: new RegExp(`(?:${w})(?:の音色|の音|っぽい音|っぽく)?`, 'g'), item: m => ({ kind: 'template', template: t, phrase: m[0] }) })),
  ...EN_TEMPLATES.map(([t, w]): Rule => ({ re: new RegExp(`\\b(?:${w})\\b(?: sound| patch| synth)?`, 'g'), item: m => ({ kind: 'template', template: t, phrase: m[0] }) })),
  // ---- effects
  ...JA_FX.flatMap(([f, w]): Rule[] => [
    { re: new RegExp(`(?:${w})${O}(?:多め|強め|深め|増や|上げ|もっと)`, 'g'), item: fx(f, 'more') },
    { re: new RegExp(`(?:${w})${O}(?:少なめ|弱め|浅め|減ら|下げ|控えめ)`, 'g'), item: fx(f, 'less') },
    { re: new RegExp(`(?:${w})(?:を|も)?\\s*(?:足し|足す|かけ|掛け|追加|入れ|付け|つけ|加え|プラス|欲しい|ほしい|乗せ|のせ)`, 'g'), item: fx(f, 'add') },
  ]),
  ...EN_FX.flatMap(([f, w]): Rule[] => [
    { re: new RegExp(`\\bmore (?:${w})\\b`, 'g'), item: fx(f, 'more') },
    { re: new RegExp(`\\b(?:less|fewer) (?:${w})\\b`, 'g'), item: fx(f, 'less') },
    { re: new RegExp(`\\b(?:add|put|insert|with|use|give it|throw in|slap on|some)(?: an?| some| the)? (?:${w})\\b`, 'g'), item: fx(f, 'add') },
  ]),
  // ---- Japanese adjustments
  ...JA_NOUNS.flatMap(([aspect, w]): Rule[] => [
    { re: new RegExp(`(?:${w})(?:を|は)?\\s*(?:最大|max|全開|一番(?:上|高|長|強)く?)(?:に|まで)?`, 'g'), item: adj(aspect, 'set_max') },
    { re: new RegExp(`(?:${w})(?:を|は)?\\s*(?:最小|ゼロ|0|オフ|なし|一番(?:下|低|短|弱)く?)(?:に|まで)?`, 'g'), item: adj(aspect, 'set_min') },
  ]),
  { re: new RegExp(`(?:LFO|lfo|揺れ|うねり|ビブラート|トレモロ)(?:の)?(?:速さ|スピード|レート|周期)?${O}(?:速[くめ]|早[くめ]|上げ)`, 'g'), item: adj('rate', 'up') },
  { re: new RegExp(`(?:LFO|lfo|揺れ|うねり|ビブラート|トレモロ)(?:の)?(?:速さ|スピード|レート|周期)?${O}(?:遅[くめ]|ゆっくり|ゆったり|下げ)`, 'g'), item: adj('rate', 'down') },
  { re: /(?:揺れ|うねり|ビブラート|トレモロ|モジュレーション|変調)(?:を|は|が)?\s*(?:もっと|少し|ちょっと|かなり)?\s*(?:大き[くめ]|強[くめ]|深[くめ]|増や|多[くめ]|足し|つけ|付け|かけ)/g, item: adj('wobble', 'up') },
  { re: /(?:揺れ|うねり|ビブラート|トレモロ|モジュレーション|変調)(?:を|は|が)?\s*(?:もっと|少し|ちょっと|かなり)?\s*(?:小さ[くめ]|弱[くめ]|浅[くめ]|減ら|少な[くめ]|抑え|止め|なくし)|揺らさない/g, item: adj('wobble', 'down') },
  { re: /揺ら(?:して|す|せ)|揺れさせ|うねらせ|ゆらゆら/g, item: adj('wobble', 'up') },
  { re: new RegExp(`(?:アタック|立ち上がり)${O}(?:遅[くめ]|長[くめ]|ゆっくり|柔らか[くめ]|なだらか|ふわっと)`, 'g'), item: adj('attack', 'up') },
  { re: new RegExp(`(?:アタック|立ち上がり|出だし)${O}(?:速[くめ]|早[くめ]|短[くめ]|鋭[くめ]|硬[くめ]|強[くめ]|キツ[くめ]|シャープ|キレ(?:を|が)?(?:良|よ)く|パキッと|歯切れ(?:を|が)?(?:良|よ)く)`, 'g'), item: adj('attack', 'down') },
  { re: new RegExp(`(?:ディケイ|ディケー|減衰)${O}(?:長[くめ]|伸ば|ゆっくり)`, 'g'), item: adj('decay', 'up') },
  { re: new RegExp(`(?:ディケイ|ディケー|減衰)${O}(?:短[くめ]|速[くめ]|早[くめ])`, 'g'), item: adj('decay', 'down') },
  { re: new RegExp(`(?:サステイン|サスティン|サステン|サスティーン)${O}${JA_UP}`, 'g'), item: adj('sustain', 'up') },
  { re: new RegExp(`(?:サステイン|サスティン|サステン|サスティーン)${O}${JA_DOWN}`, 'g'), item: adj('sustain', 'down') },
  { re: new RegExp(`(?:リリース|余韻|音の尻尾|尻尾)${O}(?:長[くめ]|伸ば|ゆっくり|残し|多[くめ])`, 'g'), item: adj('release', 'up') },
  { re: new RegExp(`(?:リリース|余韻|音の尻尾|尻尾)${O}(?:短[くめ]|切っ|切れ|速[くめ]|早[くめ]|少な[くめ])`, 'g'), item: adj('release', 'down') },
  { re: new RegExp(`(?:レゾナンス|レゾ|クセ|ピーク|q)${O}${JA_UP}`, 'g'), item: adj('resonance', 'up') },
  { re: new RegExp(`(?:レゾナンス|レゾ|クセ|ピーク|q)${O}${JA_DOWN}`, 'g'), item: adj('resonance', 'down') },
  { re: new RegExp(`(?:繰り返し|リピート|フィードバック|反復)${O}${JA_UP}`, 'g'), item: adj('feedback', 'up') },
  { re: new RegExp(`(?:繰り返し|リピート|フィードバック|反復)${O}${JA_DOWN}`, 'g'), item: adj('feedback', 'down') },
  { re: new RegExp(`(?:ディレイタイム|ディレイの時間|遅延時間|ディレイ時間)${O}(?:長[くめ]|伸ば)`, 'g'), item: adj('time', 'up') },
  { re: new RegExp(`(?:ディレイタイム|ディレイの時間|遅延時間|ディレイ時間)${O}(?:短[くめ])`, 'g'), item: adj('time', 'down') },
  { re: new RegExp(`(?:ウェット|エフェクト|かかり)${O}(?:強[くめ]|多[くめ]|深[くめ]|上げ|増や)|ウェットに`, 'g'), item: adj('mix', 'up') },
  { re: new RegExp(`(?:エフェクト|かかり)${O}(?:弱[くめ]|少な[くめ]|浅[くめ]|下げ|減ら)|ドライに|ドライめ`, 'g'), item: adj('mix', 'down') },
  { re: new RegExp(`歪み${O}(?:弱[くめ]|減ら|抑え|少な[くめ]|なくし)|クリーンに|綺麗な音に`, 'g'), item: adj('drive', 'down') },
  { re: new RegExp(`歪み${O}(?:強[くめ]|増や|多[くめ]|足し|深[くめ])|歪ませ|歪ま[せし]|歪めて|汚し|ドライブ(?:感)?${O}(?:上げ|強|増)?|サチュレーション|ザラザラ|ガリガリ`, 'g'), item: adj('drive', 'up') },
  { re: new RegExp(`(?:グライド|ポルタメント)${O}(?:長[くめ]|強[くめ]|かけ|増や|足し|つけ|付け)`, 'g'), item: adj('glide', 'up') },
  { re: new RegExp(`(?:グライド|ポルタメント)${O}(?:短[くめ]|弱[くめ]|なくし|減ら|切っ)`, 'g'), item: adj('glide', 'down') },
  { re: new RegExp(`(?:音量|ボリューム|音)${O}(?:上げ|大き[くめ])|うるさく`, 'g'), item: adj('volume', 'up') },
  { re: new RegExp(`(?:音量|ボリューム|音)${O}(?:下げ|小さ[くめ])|うるさい|静かに`, 'g'), item: adj('volume', 'down') },
  { re: new RegExp(`(?:フィルター|フィルタ|カットオフ)${O}(?:開[いけ]|上げ)`, 'g'), item: adj('brightness', 'up') },
  { re: new RegExp(`(?:フィルター|フィルタ|カットオフ)${O}(?:閉じ|閉め|下げ)`, 'g'), item: adj('brightness', 'down') },
  { re: /明る[くいめさ]|ブライト|抜け(?:を|が)?(?:良|よ)く|きらびやか|シャキッと|キラキラ|高域(?:を|が)?(?:上げ|足し|強)|抜けよく/g, item: adj('brightness', 'up') },
  { re: /暗[くいめさ]|こも[らっりる]|籠[らっりる]|ダーク|丸[くみめ]|まろやか|モコモコ|もこもこ|高域(?:を|が)?(?:下げ|削|抑え)|こもった/g, item: adj('brightness', 'down') },
  // ---- English adjustments
  { re: /\b(?:faster|quicker|speed up the) (?:lfo|wobble|vibrato|tremolo|modulation)\b|\b(?:lfo|wobble|vibrato|modulation) faster\b/g, item: adj('rate', 'up') },
  { re: /\b(?:slower|slow down the) (?:lfo|wobble|vibrato|tremolo|modulation)\b|\b(?:lfo|wobble|vibrato|modulation) slower\b/g, item: adj('rate', 'down') },
  { re: /\b(?:more|deeper|stronger|heavier) (?:wobble|vibrato|tremolo|modulation|movement|lfo)\b|\bwobblier\b|\bwobble (?:it )?more\b|\bmake it wobble\b/g, item: adj('wobble', 'up') },
  { re: /\b(?:less|shallower|weaker|lighter|no) (?:wobble|vibrato|tremolo|modulation|movement)\b|\bsteadier\b/g, item: adj('wobble', 'down') },
  { re: /\b(?:slower|softer|longer|gentler|smoother) attack\b|\bfade[- ]in\b|\bswell(?:ing)?\b/g, item: adj('attack', 'up') },
  { re: /\b(?:faster|sharper|shorter|harder|quicker) attack\b|\bsnappier\b|\bpunchier\b|\bmore punch(?: (?:at|in) the (?:start|beginning|front)(?: of (?:each|the|every) notes?)?)?\b/g, item: adj('attack', 'down') },
  { re: /\blonger decay\b|\bmore decay\b/g, item: adj('decay', 'up') },
  { re: /\bshorter decay\b|\bless decay\b/g, item: adj('decay', 'down') },
  { re: /\b(?:more|higher) sustain\b/g, item: adj('sustain', 'up') },
  { re: /\b(?:less|lower) sustain\b/g, item: adj('sustain', 'down') },
  { re: /\b(?:longer|more) (?:release|tail)\b|\blet it ring(?: out)?\b|\blonger notes?\b/g, item: adj('release', 'up') },
  { re: /\b(?:shorter|less|tighter|quicker) (?:release|tail)\b|\bstaccato\b/g, item: adj('release', 'down') },
  { re: /\bmore (?:resonance|resonant|q|peak)\b|\b(?:more )?resonant\b|\bsquelch(?:y|ier)\b/g, item: adj('resonance', 'up') },
  { re: /\bless (?:resonance|resonant|q|peak)\b/g, item: adj('resonance', 'down') },
  { re: /\bmore (?:repeats|feedback|echoes)\b/g, item: adj('feedback', 'up') },
  { re: /\b(?:fewer|less) (?:repeats|feedback|echoes)\b/g, item: adj('feedback', 'down') },
  { re: /\blonger delay(?: time)?\b/g, item: adj('time', 'up') },
  { re: /\bshorter delay(?: time)?\b/g, item: adj('time', 'down') },
  { re: /\bwetter\b|\bmore (?:wet|effect|effects|fx)\b/g, item: adj('mix', 'up') },
  { re: /\bdrier\b|\bdryer\b|\bless (?:wet|effect|effects|fx)\b/g, item: adj('mix', 'down') },
  { re: /\b(?:add |give it )?(?:some |a bit of )?(?:grit|crunch|dirt|fuzziness)\b|\bgritty\b|\bcrunchy\b/g, item: adj('drive', 'up') },
  { re: /\bfade (?:[a-z]+ ){0,3}in(?: slowly| gently| softly)?\b|\bstart (?:more )?(?:gently|softly|slowly)\b/g, item: adj('attack', 'up') },
  { re: /\b(?:less|not so|too) harsh\b|\bsofter tone\b|\btame the highs\b/g, item: adj('brightness', 'down') },
  { re: /\bmore (?:drive|grit|saturation|crunch|dirt)\b|\bdirtier\b|\bgrittier\b|\bcrunchier\b|\bdistort(?:ed)?(?: it)?\b|\bsaturate(?: it)?\b/g, item: adj('drive', 'up') },
  { re: /\bless (?:drive|grit|distortion|saturation|crunch|dirt)\b|\bcleaner\b/g, item: adj('drive', 'down') },
  { re: /\bmore (?:glide|portamento|slide)\b|\badd (?:glide|portamento)\b/g, item: adj('glide', 'up') },
  { re: /\b(?:less|no) (?:glide|portamento|slide)\b/g, item: adj('glide', 'down') },
  { re: /\blouder\b|\bturn (?:it )?up\b|\bmore volume\b/g, item: adj('volume', 'up') },
  { re: /\bquieter\b|\bturn (?:it )?down\b|\bless volume\b/g, item: adj('volume', 'down') },
  { re: /\bopen (?:up )?the filter\b|\bfilter (?:more )?open\b/g, item: adj('brightness', 'up') },
  { re: /\bclose (?:down )?the filter\b/g, item: adj('brightness', 'down') },
  { re: /\bbright(?:er|en(?: it)?(?: up)?)?\b|\bmore (?:treble|highs|top end|air|sparkle|bright)\b|\bcrisp(?:er)?\b|\bairier\b/g, item: adj('brightness', 'up') },
  { re: /\bdark(?:er|en(?: it)?)?\b|\bduller\b|\bmuffled?\b|\bmellow(?:er)?\b|\bwarmer\b|\bless (?:treble|highs|top end|bright)\b|\bmuddier\b/g, item: adj('brightness', 'down') },
];

const AMOUNT_RULES: Array<[RegExp, Amount | 'max' | 'min']> = [
  [/ほんの少し|ほんのちょっと|わずかに|気持ち|ちょびっと|\b(?:a tiny bit|a touch|just a little|slightly|barely)\b/g, 'tiny'],
  [/思いっきり|思い切り|めちゃくちゃ|めっちゃ|極端に|最大限|\b(?:extremely|massively|tons|insanely|crazy)\b/g, 'extreme'],
  [/かなり|すごく|すっごく|とても|ぐっと|うんと|たっぷり|大幅に|\b(?:much|a lot|lots|way|really|very|heavily)\b/g, 'large'],
  [/もう少し|もうちょっと|少し|ちょっと|やや|軽く|すこし|少々|若干|心持ち|\b(?:a (?:little )?bit|a little|somewhat|a tad|a bit)\b/g, 'small'],
  [/(?:最大|MAX|max|全開)(?:に|まで)?|\b(?:all the way(?: up)?|to the max|fully|maximum)\b/g, 'max'],
  [/(?:最小|ゼロ|0|オフ)(?:に|まで)|\b(?:all the way down|minimum|to zero)\b/g, 'min'],
];

const CREATE_VERB = /作っ|作り|作る|作れ|つくっ|つくり|ちょうだい|ください|下さい|ほしい|欲しい|にして|に変え|用意|鳴らし|\b(?:make|build|create|start|give me|i want|i need|new|design|turn (?:it|this) into)\b/g;

/** Describing words that are fine to drop next to a template ("太いベース", "a fat bass"). */
const TEMPLATE_ADJ = /太い|太め|分厚い|重い|重め|深い|ふわっとした|ふわふわ(?:の|した)?|柔らかい|やわらかい|暖かい|温かい|きれいな|綺麗な|シンプルな|かっこいい|いい感じの|\b(?:fat|thick|deep|heavy|big|huge|lush|warm|soft|simple|evolving|nice|cool|classic|analog(?:ue)?|smooth|good|new|basic)\b/g;

/** Words that carry no meaning of their own once the intent is recognised. */
const FILLER_JA = /(?:お願い(?:します)?|ください|下さい|ちょうだい|してみて|して|してね|しよう|させて|せて|て|にする|にして|みて|もっと|さらに|さらにもう|全体(?:的に)?|音色|サウンド|感じ|気味|の|を|に|が|は|と|で|も|な|ね|よ|か|、|。|！|？|!|\?|・|\s)/g;
const FILLER_EN = /\b(?:please|pls|can|could|would|you|make|it|this|that|the|a|an|sound|sounds|tone|bit|more|and|also|then|now|just|to|me|some|little|be|is|its|it's|too|so|patch|overall|whole|thing|lot|of|up|go|get|let's|lets|i|want|like|maybe|kinda|kind|sort)\b|[.,!?;:'"\s-]/g;

export function detectLanguage(text: string): 'ja' | 'en' {
  return /[぀-ヿ㐀-鿿]/.test(text) ? 'ja' : 'en';
}

/**
 * Read a request. `screen`: the person is editing the plugin screen, so words
 * like "darker" mean the screen (a request that names the screen counts too).
 */
export function parseRequest(raw: string, options: { screen?: boolean } = {}): LexResult {
  const text = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const lang = detectLanguage(text);
  const screen = !!options.screen || SCREEN_WORDS.test(lower);
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const found: Array<{ at: number; end: number; item: LexItem }> = [];
  for (const rule of [COMPLEX, ...SCREEN_RULES, ...(screen ? SCREEN_CONTEXT_RULES : []), ...RULES]) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(lower); m; m = rule.re.exec(lower)) {
      if (!m[0]) { rule.re.lastIndex++; continue; }
      const s = m.index, e = s + m[0].length;
      if (overlaps(s, e)) continue;
      taken.push([s, e]);
      found.push({ at: s, end: e, item: rule.item(m) });
    }
  }
  // A template noun counts only next to a "make" verb ("ベース作って", "make a bass"); "more bass" is not a template.
  const templates = found.filter(f => f.item.kind === 'template');
  if (templates.length) {
    CREATE_VERB.lastIndex = 0;
    const verbs = [...lower.matchAll(CREATE_VERB)].filter(m => !overlaps(m.index!, m.index! + m[0].length) || templates.some(t => m.index! >= t.at && m.index! < t.end));
    if (verbs.length) { for (const v of verbs) taken.push([v.index!, v.index! + v[0].length]); for (const t of templates.slice(1)) drop(t); }
    else for (const t of templates) drop(t);
  }
  function drop(f: typeof found[number]) { found.splice(found.indexOf(f), 1); taken.splice(taken.findIndex(([a, b]) => a === f.at && b === f.end), 1); }
  // Amount modifiers: attach to the nearest intent (before it in Japanese and usually English too).
  const modifiers: Array<{ at: number; end: number; amount: Amount | 'max' | 'min' }> = [];
  for (const [re, amount] of AMOUNT_RULES) {
    re.lastIndex = 0;
    for (let m = re.exec(lower); m; m = re.exec(lower)) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(s, e) && !found.some(f => s >= f.at && e <= f.end)) continue;
      if (!found.some(f => s >= f.at && e <= f.end)) taken.push([s, e]);
      modifiers.push({ at: s, end: e, amount });
    }
  }
  found.sort((a, b) => a.at - b.at);
  for (const mod of modifiers) {
    const inside = found.find(f => mod.at >= f.at && mod.end <= f.end);
    const target = inside ?? found.filter(f => f.at >= mod.end).sort((a, b) => a.at - b.at)[0] ?? found.filter(f => f.end <= mod.at).sort((a, b) => b.end - a.end)[0];
    if (!target || target.item.kind === 'template' || target.item.kind === 'complex') continue;
    if (target.item.kind === 'adjust') {
      if (mod.amount === 'max') target.item.direction = target.item.direction === 'down' ? 'set_min' : 'set_max';
      else if (mod.amount === 'min') target.item.direction = 'set_min';
      else if (!target.item.amount || inside === undefined) target.item.amount = mod.amount;
    } else if ((target.item.kind === 'fx' || target.item.kind === 'look') && mod.amount !== 'max' && mod.amount !== 'min') target.item.amount = mod.amount;
  }
  let rest = '';
  for (let i = 0; i < lower.length; i++) if (!taken.some(([a, b]) => i >= a && i < b)) rest += lower[i]; else rest += ' ';
  if (found.some(f => f.item.kind === 'template')) rest = rest.replace(TEMPLATE_ADJ, ' ');
  if (found.some(f => f.item.kind === 'look')) rest = rest.replace(SCREEN_FILLER, ' ');
  const leftover = rest.replace(FILLER_EN, ' ').replace(FILLER_JA, '').replace(/\s+/g, ' ').trim();
  const meaningful = leftover.replace(/[^\p{L}\p{N}]/gu, '');
  // "warmer and less harsh" says the same thing twice: one step, not two.
  const items: LexItem[] = [];
  for (const { item } of found) {
    const same = items.find(i => i.kind === item.kind && JSON.stringify({ ...i, phrase: '', amount: undefined }) === JSON.stringify({ ...item, phrase: '', amount: undefined }));
    if (!same) items.push(item);
  }
  return { items, screen, full: items.length > 0 && meaningful.length <= 1, leftover, lang };
}
