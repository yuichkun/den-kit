import type { EdgeId, NodeId, PortId } from './schema.ts';

export type Severity = 'error' | 'warning' | 'info';

/** A validation or compile finding, attached to the node/port/edge it concerns. */
export interface Issue {
  severity: Severity;
  /** Stable machine id, e.g. `cycle`, `voice-to-global`, `unknown-type`. */
  code: string;
  message: string;
  node?: NodeId;
  port?: PortId;
  edge?: EdgeId;
  /** Codebox-relative position, when the issue is inside codebox source. */
  line?: number;
  column?: number;
}

export const hasErrors = (issues: readonly Issue[]) => issues.some(i => i.severity === 'error');

export function formatIssue(issue: Issue): string {
  const where = [issue.node, issue.port].filter(Boolean).join('.');
  const at = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
  return `${issue.severity} ${issue.code}${where ? ` @${where}${at}` : ''}: ${issue.message}`;
}
