import { Catalog } from '../../work/catalog.ts';
import { denBlocks } from './den.ts';
import { kitIO, kitParts, kitPrimitives, kitStacks, kitWidgets } from './kit.ts';

export { denBlocks } from './den.ts';
export { kitIO, kitParts, kitPrimitives, kitStacks, kitWidgets, PROBE_TYPES } from './kit.ts';

/** The default den-kit catalog (isomorphic: used by the browser, the bridge and tests). */
export const catalog = new Catalog([
  ...kitIO,
  ...denBlocks,
  ...kitPrimitives,
  ...kitStacks,
  ...kitWidgets,
  ...kitParts,
]);
