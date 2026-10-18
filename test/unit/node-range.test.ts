import { describe, expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { inNodeRange } from '../../scripts/node-range.ts';

describe('Node.js range', () => {
  it('holds from the lower bound up to the next major', () => {
    expect(inNodeRange('24.10.9', '>=24.11 <25')).toBe(false);
    expect(inNodeRange('24.11.0', '>=24.11 <25')).toBe(true);
    expect(inNodeRange('v24.21.0', '>=24.11 <25')).toBe(true);
    expect(inNodeRange('25.0.0', '>=24.11 <25')).toBe(false);
    expect(inNodeRange('22.22.0', '>=24.11 <25')).toBe(false);
  });

  it('takes the version in .node-version and refuses 24 before 24.11 under package.json engines', () => {
    const range = JSON.parse(readFileSync('package.json', 'utf8')).engines.node as string;
    expect(inNodeRange(readFileSync('.node-version', 'utf8').trim(), range)).toBe(true);
    expect(inNodeRange('24.10.0', range)).toBe(false);
  });

  it('does not pass a range written in a form it does not read', () => {
    expect(inNodeRange('24.21.0', '^24.11.0')).toBe(false);
    expect(inNodeRange('24.21.0', '>=22 || >=24')).toBe(false);
  });
});
