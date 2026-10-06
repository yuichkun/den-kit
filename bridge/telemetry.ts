// Append-only JSONL log (routing traces, adoption, errors). One file per day.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Telemetry {
  readonly dir: string;
  private failed = false;
  constructor(dir: string) { this.dir = dir; }
  file(kind: string, at = new Date()) { return join(this.dir, `${kind}-${at.toISOString().slice(0, 10)}.jsonl`); }
  write(kind: string, record: Record<string, unknown>) {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file(kind), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
    } catch (error) {
      if (!this.failed) { this.failed = true; console.warn(`[den-kit] telemetry disabled: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
