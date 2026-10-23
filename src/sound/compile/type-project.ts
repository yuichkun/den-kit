// Codebox type checking with the TypeScript language service over a snapshot of
// @unworklet/core declarations (adapted from playground/src/typescript-project.ts).
import ts from 'typescript';
import type { Issue } from '../../work/issues.ts';
import type { PortSpec } from '../../work/schema.ts';

export type TypeFiles = {
  files: Record<string, string>;
  packages: Record<string, { version: string }>;
};

export function createTypeProject(snapshot: TypeFiles) {
  const scripts = new Map<string, { text: string; version: number }>();
  const files = snapshot.files;
  const directories = new Set<string>();
  for (const name of Object.keys(files)) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      directories.add(parts.join('/') || '/');
    }
  }
  const normalize = (name: string) => {
    const parts: string[] = [];
    for (const part of name.split('/'))
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    return '/' + parts.join('/');
  };
  const read = (name: string) => scripts.get(normalize(name))?.text ?? files[normalize(name)];
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noImplicitAny: false,
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    lib: ['lib.es2023.d.ts'],
    types: [],
  };
  const cached = new Map<string, ts.IScriptSnapshot>();
  let projectVersion = 0;
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [...scripts.keys()],
    getScriptVersion: name => String(scripts.get(normalize(name))?.version ?? 0),
    getProjectVersion: () => String(projectVersion),
    getScriptSnapshot(name) {
      const script = scripts.get(normalize(name));
      if (script) return ts.ScriptSnapshot.fromString(script.text);
      const text = read(name);
      if (text === undefined) return undefined;
      let value = cached.get(name);
      if (!value) {
        value = ts.ScriptSnapshot.fromString(text);
        cached.set(name, value);
      }
      return value;
    },
    getCurrentDirectory: () => '/project',
    getDefaultLibFileName: () => '/project/node_modules/typescript/lib/lib.es2023.d.ts',
    fileExists: name => read(name) !== undefined,
    readFile: read,
    directoryExists: name => directories.has(normalize(name)) || normalize(name) === '/project',
    getDirectories: name =>
      [...directories].filter(
        dir =>
          dir.startsWith(normalize(name) + '/') &&
          !dir.slice(normalize(name).length + 1).includes('/'),
      ),
    readDirectory: () => [],
    realpath: name => normalize(name),
    useCaseSensitiveFileNames: () => true,
  };
  const service = ts.createLanguageService(host);
  const set = (name: string, text: string) => {
    const old = scripts.get(name);
    if (old?.text === text) return;
    scripts.set(name, { text, version: (old?.version ?? 0) + 1 });
    projectVersion++;
  };

  /** Type-check one codebox against its declared ports. Returns codebox-relative issues. */
  function checkCodebox(
    node: string,
    code: string,
    inputs: readonly PortSpec[],
    outputs: readonly PortSpec[],
  ): Issue[] {
    const box = `/project/${node}.box.ts`,
      check = `/project/${node}.check.ts`;
    const t = (p: PortSpec) => (p.type === 'gate' ? "Node<'bool'>" : "Node<'f32'>");
    set(box, code);
    set(
      check,
      [
        `import box from './${node}.box.ts';`,
        "import type { Node, SubgraphDecl } from '@unworklet/core';",
        'type Methods = typeof box extends SubgraphDecl<any, infer M> ? M : never;',
        'declare const methods: Methods;',
        `declare const inputs: { ${inputs.map(p => `${p.id}: ${t(p)};`).join(' ')} };`,
        'const result = methods.tick(inputs);',
        `export const ports: { ${outputs.map(p => `${p.id}: ${t(p)};`).join(' ')} } = result;`,
      ].join('\n'),
    );
    const issues: Issue[] = [];
    const push = (d: ts.Diagnostic, harness: boolean) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (harness) {
        issues.push({
          severity: 'error',
          code: 'codebox-ports',
          node,
          message: `The default export must be defineSubgraph(config => ({ tick(i) { … return { ${outputs.map(p => p.id).join(', ')} } } })) taking { ${inputs.map(p => p.id).join(', ')} }. ${message}`,
        });
        return;
      }
      const pos =
        d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      issues.push({
        severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: `ts${d.code}`,
        node,
        message,
        line: pos ? pos.line + 1 : undefined,
        column: pos ? pos.character + 1 : undefined,
      });
    };
    for (const d of [
      ...service.getSyntacticDiagnostics(box),
      ...service.getSemanticDiagnostics(box),
    ])
      push(d, false);
    if (!issues.some(i => i.severity === 'error'))
      for (const d of service.getSemanticDiagnostics(check)) push(d, true);
    return issues;
  }
  return { checkCodebox, dispose: () => service.dispose() };
}
