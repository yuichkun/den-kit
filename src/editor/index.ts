// editor: the editing app's entry and den-kit's own screens. A host starts it
// with startEditor (start.ts); it opens a work from the host's storage, starts
// sound, screen, ai and, when the host provides one, workspace, and saves the
// record after each change. It knows the host only through src/host. Its look
// comes from the themes of the design system (docs/design-system.md).
export { startEditor, type EditorOptions } from './start.ts';
