import { Catalog } from '../core/catalog.ts';
import { denBlocks } from './den.ts';
import { kitIO, kitPrimitives, kitWidgets } from './kit.ts';

export { denBlocks } from './den.ts';
export { kitIO, kitPrimitives, kitWidgets, PROBE_TYPES } from './kit.ts';

/** The default den-kit catalog (isomorphic: used by the browser, the bridge and tests). */
export const catalog = new Catalog([...kitIO, ...denBlocks, ...kitPrimitives, ...kitWidgets]);
