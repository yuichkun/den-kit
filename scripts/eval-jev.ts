// `npm run kit:eval:jev`: ask the real Jev (key from kit/.env) every fixture in
// eval-jev.fixtures.json with exactly the questions the fast path sends, and
// print accuracy, latency and a τ table (how much gets applied, and how much of
// that is right) for English and Japanese. Used to choose τ at CP2a.
// The lexicon is bypassed here on purpose: this measures Jev alone.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, maskSecret } from '../bridge/env.ts';
import { JevClient, JEV_MODEL } from '../bridge/jev.ts';
import { catalog } from '../src/blocks/index.ts';
import { starter, type StarterId } from '../src/core/starters.ts';
import { buildFullRequest } from '../src/ai/jev-questions.ts';
import { readAnswers, type Choice } from '../src/ai/jev-answers.ts';
import { parseRequest } from '../src/ai/lexicon.ts';
import { ambiguousTargets, aspectKey, availableAspects } from '../src/ai/router.ts';

type Expect = { route: string; aspect?: string; direction?: string; fx?: string; template?: string };
interface Fixture { text: string; starter?: StarterId; expect: Expect; alsoOk?: Expect }

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(join(kit, '.env'));
const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error('TYPESAFE_API_KEY is not set. Put it in kit/.env (git-ignored) and run again.'); process.exit(1); }
const fixtures = JSON.parse(readFileSync(new URL('./eval-jev.fixtures.json', import.meta.url), 'utf8')) as Fixture[];
const only = process.argv.slice(2).join(' ').trim();
const jev = new JevClient({ apiKey: key, baseUrl: process.env.KIT_JEV_BASE });
console.log(`Jev ${JEV_MODEL} · key ${maskSecret(key)} · ${fixtures.length} fixtures${only ? ` matching "${only}"` : ''}\n`);

interface Row { text: string; lang: 'ja' | 'en'; lexicon: boolean; ok: boolean; correct: boolean; got: string; want: string; confidence: number; agree: boolean; ms: number; error?: string }
const rows: Row[] = [];
const describe = (e: Partial<Expect>) => [e.route, e.aspect, e.direction, e.fx, e.template].filter(Boolean).join(' ');
const matches = (got: Expect, want?: Expect) => !!want && got.route === want.route && (want.route !== 'adjust' || (got.aspect === want.aspect && got.direction === want.direction)) && (want.route !== 'add_effect' || got.fx === want.fx) && (want.route !== 'create' || got.template === want.template);

for (const f of fixtures.filter(f => !only || f.text.includes(only))) {
  const doc = starter(f.starter ?? 'bass', catalog);
  const ctx = { doc, catalog, selection: [] as string[] };
  const lex = parseRequest(f.text);
  const built = buildFullRequest({ text: f.text, lang: lex.lang, selection: '', aspects: availableAspects(ctx), targets: ambiguousTargets(ctx) });
  const result = await jev.ask(built.request, { budgetMs: 8000 });
  if (!result.ok) { rows.push({ text: f.text, lang: lex.lang, lexicon: lex.full, ok: false, correct: false, got: '', want: describe(f.expect), confidence: 0, agree: false, ms: result.ms, error: `${result.error.kind}: ${result.error.message}` }); console.log(`ERR  ${f.text}  ${result.error.message}`); continue; }
  const { answers: a, errors } = readAnswers(result.response.answers, built.request.questions as Record<string, { criteria?: unknown }>);
  const route = a.route;
  // The aspect options carry their direction ("attack_down" = faster start).
  const ad = aspectKey(a.aspect?.choice);
  const got: Expect = { route: route?.choice ?? '?', aspect: ad?.aspect ?? a.aspect?.choice, direction: ad?.direction, fx: a.fx?.choice, template: a.template?.choice };
  const parts: Array<Choice | undefined> = [route];
  if (got.route === 'adjust') parts.push(a.aspect);
  if (got.route === 'add_effect') parts.push(a.fx);
  if (got.route === 'create') parts.push(a.template);
  const agree = parts.every(p => p?.agree !== false);
  const confidence = Math.min(...parts.map(p => p?.confidence ?? 0));
  const correct = matches(got, f.expect) || matches(got, f.alsoOk);
  rows.push({ text: f.text, lang: lex.lang, lexicon: lex.full, ok: true, correct, got: describe(got.route === 'adjust' ? { route: got.route, aspect: got.aspect, direction: got.direction } : got.route === 'add_effect' ? { route: got.route, fx: got.fx } : got.route === 'create' ? { route: got.route, template: got.template } : { route: got.route }), want: describe(f.expect), confidence, agree, ms: result.ms, error: errors.length ? errors.join('; ') : undefined });
  console.log(`${correct ? 'ok ' : 'BAD'}  ${(confidence * 100).toFixed(0).padStart(3)}%${agree ? ' ' : '≠'} ${String(result.ms).padStart(5)} ms  ${f.text}${correct ? '' : `\n      got: ${rows.at(-1)!.got}\n     want: ${rows.at(-1)!.want}`}${errors.length ? `\n     answer problems: ${errors.join('; ')}` : ''}`);
}

const pct = (n: number, d: number) => d ? `${Math.round((100 * n) / d)}%` : '—';
const ms = rows.filter(r => r.ok).map(r => r.ms).sort((x, y) => x - y);
console.log(`\nAnswered ${rows.filter(r => r.ok).length}/${rows.length} · correct ${pct(rows.filter(r => r.correct).length, rows.length)} · latency p50 ${ms[Math.floor(ms.length / 2)] ?? '—'} ms, p90 ${ms[Math.floor(ms.length * 0.9)] ?? '—'} ms`);
console.log(`(The lexicon alone fully handles ${rows.filter(r => r.lexicon).length}/${rows.length} of these; Jev is skipped for those in the app.)\n`);
console.log('τ table: "applied" = share of requests the fast path would apply; "right" = share of applied ones that were correct.');
console.log('  τ    | EN applied  right | JA applied  right');
for (const tau of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
  const cell = (lang: 'en' | 'ja') => {
    const all = rows.filter(r => r.lang === lang);
    const applied = all.filter(r => r.ok && r.agree && r.confidence >= tau);
    return `${pct(applied.length, all.length).padStart(7)} ${pct(applied.filter(r => r.correct).length, applied.length).padStart(6)}`;
  };
  console.log(`  ${tau.toFixed(2)} | ${cell('en')}    | ${cell('ja')}`);
}
const out = join(kit, '.logs', `eval-jev-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ model: JEV_MODEL, at: new Date().toISOString(), rows }, null, 1));
console.log(`\nSaved ${out}`);
