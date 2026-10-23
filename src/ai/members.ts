// Members of an LLM team (U8): what the lead writes for each one (the brief),
// what den-kit adds to it without the lead spending a word (the person's own
// words, the recent conversation, what they attached or sketched, the state of
// the member's scope, the names everyone keeps), and how members' reports read
// to the lead. Pure functions: src/ai/llm.ts runs the team.
import { textFiles } from '../work/files.ts';
import type { Catalog } from '../work/catalog.ts';
import { describePatch } from './describe.ts';
import type { PatchDocument } from '../work/schema.ts';
import type { TokenUsage } from '../host/ai.ts';
import { describePlugin } from './plugin-tools.ts';
import { describeScope, parseScope, type Scope, type Seam } from './scope.ts';

/** Members working at once under one lead. */
export const MAX_MEMBERS = 3;
/** How a member learns the conversation: the lead's brief with den-kit's notes, also the whole conversation, or the brief alone. */
export type MemberContext = 'brief' | 'full' | 'bare';
export const MEMBER_CONTEXTS: readonly MemberContext[] = ['brief', 'full', 'bare'];
/** Lane colours (the lead uses the accent). */
export const MEMBER_COLORS = ['#4fc3f7', '#c792ea', '#9ccc65'] as const;

export interface Brief {
  name: string;
  goal: string;
  why?: string;
  scope: Scope;
  done: string;
  notes?: string;
  context: MemberContext;
}
export interface MemberReport {
  summary: string;
  names: string[];
  needs: string[];
  problems: string[];
}

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** The members kit_delegate asks for, checked (each scope against the patch). */
export function parseBriefs(
  value: unknown,
  doc: PatchDocument,
  forced?: MemberContext,
): { briefs: Brief[] } | { error: string } {
  const list = (value as { members?: unknown } | null)?.members;
  if (!Array.isArray(list) || !list.length)
    return { error: 'members must be a non-empty list of {name, goal, scope, done}.' };
  if (list.length > MAX_MEMBERS) return { error: `At most ${MAX_MEMBERS} members at once.` };
  const briefs: Brief[] = [];
  for (const [i, raw] of list.entries()) {
    const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = str(m.name, 24),
      goal = str(m.goal, 1200),
      done = str(m.done, 600);
    if (!name || !goal || !done)
      return { error: `Member #${i + 1} needs a name, a goal and when it is done.` };
    const scope = parseScope(m.scope, doc);
    if ('error' in scope) return { error: `Member #${i + 1} (“${name}”): ${scope.error}` };
    const context =
      forced ??
      (MEMBER_CONTEXTS.includes(m.context as MemberContext)
        ? (m.context as MemberContext)
        : 'brief');
    briefs.push({
      name,
      goal,
      why: str(m.why, 600) || undefined,
      scope: scope.scope,
      done,
      notes: str(m.notes, 1200) || undefined,
      context,
    });
  }
  const names = briefs.map(b => b.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: 'Give each member its own name.' };
  return { briefs };
}

/** The member's report from its kit_finish arguments. */
export function reportOf(args: Record<string, unknown>): MemberReport {
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((s): s is string => typeof s === 'string' && !!s.trim())
          .map(s => s.trim().slice(0, 300))
          .slice(0, 20)
      : [];
  return {
    summary: str(args.summary, 400),
    names: list(args.names),
    needs: list(args.needs),
    problems: list(args.problems),
  };
}

/** The names everyone keeps while members work: the controls with what they drive, and the parts. */
export function seamText(doc: PatchDocument, catalog: Catalog, seam: Seam): string {
  const drives = (id: string) =>
    Object.values(doc.edges)
      .filter(e => e.from.node === id)
      .map(e => `${e.to.node}.${e.to.port}`);
  const controls = [...seam.controls]
    .filter(id => doc.nodes[id])
    .map(id => {
      const n = doc.nodes[id]!;
      const def = catalog.find(n.type);
      const range =
        n.config.min !== undefined && n.config.max !== undefined
          ? ` ${n.config.min}–${n.config.max}${n.config.unit ? ` ${n.config.unit}` : ''}`
          : '';
      const to = drives(id);
      return `${id} ${def?.title ?? n.type}${n.label ? ` “${n.label}”` : ''}${range}${to.length ? ` → ${to.join(', ')}` : ' (drives nothing yet)'}${n.panel ? '' : ' (not on the plugin)'}`;
    });
  const parts = Object.values(doc.parts).map(
    p =>
      `${p.id} “${p.name}” (uses: ${
        Object.values(doc.nodes)
          .filter(n => n.type === 'kit.part' && n.part === p.id)
          .map(n => n.id)
          .join(', ') || 'none'
      })`,
  );
  return [
    controls.length ? `Controls: ${controls.join('; ')}.` : 'Controls: none yet.',
    parts.length ? `Parts: ${parts.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 30)}\n… (cut, ${s.length} chars)` : s;
/** The state of a member's scope, so it need not read it first. */
export function scopeState(doc: PatchDocument, catalog: Catalog, scope: Scope): string {
  const out: string[] = [];
  if (scope.sound)
    out.push(
      `The patch now:\n${clip(describePatch(doc, catalog, { maxChars: 7000, includeIssues: true }), 7500)}`,
    );
  if (scope.screen) out.push(`The plugin screen now:\n${clip(describePlugin(doc, catalog), 9000)}`);
  if (scope.project) {
    const files = Object.keys(textFiles(doc.files)).sort();
    out.push(
      files.length
        ? `The screen project's files: ${files.slice(0, 60).join(', ')}${files.length > 60 ? ` and ${files.length - 60} more` : ''}. Read its AGENTS.md before writing code parts.`
        : "The screen project does not exist yet: your first kit_bash or kit_write_file makes it from den-kit's template (read AGENTS.md first).",
    );
  }
  return out.join('\n\n');
}

export interface MemberStart {
  id: string;
  brief: Brief;
  /** Other members working now (they hold their scopes). */
  others: Array<{ id: string; name: string; scope: Scope }>;
  /** What the person said in this request: the first words and what they added since. */
  words: string[];
  /** The recent conversation, one line per request (lineForAi). */
  recent: string[];
  /** What the person attached (describeAttachments), and where they are (inside a part). */
  attached?: string;
  where?: string;
  /** The person's sketch, in words (U8c), and whether its picture comes with this text. */
  sketch?: string;
  /** What the person is looking at (U8b). */
  seeing?: string;
  designBrief?: string;
  seam: string;
  state: string;
}

/** The member's first message: its part, then what den-kit knows (brief), or only its part and scope (bare). */
export function memberText(m: MemberStart): string {
  const b = m.brief;
  const head = [
    `[den-kit] You are a member of a team working on one request; the lead gave you a part of it.`,
    `Your name: ${b.name} (${m.id})`,
    `Goal: ${b.goal}`,
    b.why ? `Why (what the person cares about): ${b.why}` : '',
    `Your scope (you may change only this): ${describeScope(b.scope)}`,
    `Done when: ${b.done}`,
    b.notes ? `Notes from the lead: ${b.notes}` : '',
    m.others.length
      ? `Working at the same time: ${m.others.map(o => `${o.id} “${o.name}” (${describeScope(o.scope)})`).join('; ')}. Do not change what they hold.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  const parts = [head];
  if (b.context !== 'bare') {
    parts.push(
      `[den-kit] The person's request, in their own words: ${m.words.map(w => `“${w}”`).join(' — then: ')}`,
    );
    if (m.recent.length)
      parts.push(`[den-kit] Earlier in this conversation:\n${m.recent.join('\n')}`);
    if (m.attached) parts.push(`[den-kit] The person attached (points at): ${m.attached}.`);
    if (m.where) parts.push(`[den-kit] ${m.where}`);
    if (m.sketch) parts.push(`[den-kit] The person's sketch: ${m.sketch}`);
    if (m.seeing) parts.push(`[den-kit] ${m.seeing}`);
    if (m.designBrief) parts.push(`[den-kit] The design brief: ${m.designBrief}`);
  }
  parts.push(`[den-kit] Names everyone keeps:\n${m.seam}`);
  parts.push(`[den-kit] ${m.state}`);
  parts.push(
    'Start now. When your part is done (checked, listened to or looked at), call kit_finish with summary, names, needs and problems.',
  );
  return parts.join('\n\n');
}

/** For a member that gets the whole conversation: den-kit's account of it (when Codex cannot copy the lead's). */
export function conversationAccount(
  lines: string[],
  lead: { steps: string[]; message: string },
): string {
  return [
    "[den-kit] The whole conversation so far, as the lead has it (requests, results, and the lead's steps on this request):",
    lines.length ? lines.join('\n') : '(this is the first request)',
    lead.steps.length ? `The lead's steps on this request so far: ${lead.steps.join(' · ')}` : '',
    lead.message.trim() ? `The lead said: ${clip(lead.message.trim(), 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const k = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
export const tokensText = (u: TokenUsage) =>
  `${k(u.input)} in (${k(u.cached)} cached), ${k(u.output)} out${u.reasoning ? ` (${k(u.reasoning)} reasoning)` : ''}`;

export interface MemberState {
  id: string;
  name: string;
  status: 'working' | 'done' | 'failed' | 'stopped';
  ms: number;
  landed: number;
  steps: string[];
  report?: MemberReport;
  error?: string;
  stoppedBy?: 'person' | 'lead';
  usage?: TokenUsage;
  refused: number;
}
/** One member for the lead (kit_wait). */
export function memberReportText(m: MemberState): string {
  const time = `${(m.ms / 1000).toFixed(1)} s`;
  if (m.status === 'working')
    return `${m.id} “${m.name}” — still working (${time}): ${m.steps.slice(-3).join(' · ') || 'reading'}.`;
  const head =
    m.status === 'done'
      ? `${m.id} “${m.name}” — done in ${time}`
      : m.status === 'stopped'
        ? `${m.id} “${m.name}” — stopped${m.stoppedBy === 'person' ? ' by the person (do not redo it unless they ask)' : ''} after ${time}`
        : `${m.id} “${m.name}” — failed after ${time}${m.error ? `: ${m.error}` : ''}`;
  const r = m.report;
  const lines = [
    `${head}. ${m.landed} edit${m.landed === 1 ? '' : 's'} landed${m.refused ? `, ${m.refused} refused (outside its scope)` : ''}.`,
    r?.summary ? `  Summary: ${r.summary}` : m.status === 'done' ? '  (no summary)' : '',
    r?.names.length ? `  Names: ${r.names.join('; ')}` : '',
    r?.needs.length ? `  Needs: ${r.needs.join('; ')}` : '',
    r?.problems.length ? `  Problems: ${r.problems.join('; ')}` : '',
    !r && m.steps.length ? `  Its steps: ${m.steps.slice(-6).join(' · ')}` : '',
    m.usage ? `  Tokens: ${tokensText(m.usage)}.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** The lead's next turn after its members finished (it ended its own turn while they worked). */
export function integrationText(reports: string[], additions: string[]): string {
  return [
    '[den-kit] Your members have finished while your last turn was over. Their reports:',
    ...reports,
    additions.length
      ? `[den-kit] The person added meanwhile: ${additions.map(a => `“${a}”`).join(' — ')}`
      : '',
    'Check the seam (the names they share), fix what is off, look (kit_look) and listen (kit_listen) once over the whole, then kit_finish.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
