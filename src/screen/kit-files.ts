// The files den-kit adds to the kit in a work's web project: the behaviors of the
// ready-made controls, so a code part's own control responds the way den-kit's
// do. Their one source is src/behaviors; the kit gets them as they are, with
// imports written the way the project's TypeScript setup reads them.
const sources = import.meta.glob('../behaviors/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The kit's behaviors, by their path in the work's project. */
export function kitFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, text] of Object.entries(sources))
    files[`src/kit/behaviors/${key.split('/').at(-1)}`] = text.replace(
      /(from '\.\/[\w-]+)\.ts'/g,
      "$1'",
    );
  return files;
}
