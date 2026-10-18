// Whether a Node.js version is inside a package.json engines range written as comparators that
// must all hold, such as ">=24.11 <25". npm's ||, ^, ~ and x-ranges are not read: a range written
// with them never holds here, so the doctor reports it rather than passing.
export function inNodeRange(version: string, range: string): boolean {
  const numbers = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const compare = (a: string, b: string) => {
    const x = numbers(a);
    const y = numbers(b);
    for (let i = 0; i < 3; i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
    }
    return 0;
  };
  return range
    .trim()
    .split(/\s+/)
    .every(comparator => {
      const match = /^(>=|>|<=|<)(\d+(?:\.\d+){0,2})$/.exec(comparator);
      if (!match) return false;
      const order = compare(version, match[2]!);
      if (match[1] === '>=') return order >= 0;
      if (match[1] === '>') return order > 0;
      if (match[1] === '<=') return order <= 0;
      return order < 0;
    });
}
