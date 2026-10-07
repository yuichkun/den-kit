// The page den-kit shows for each code part: ?part=<name> picks src/parts/<name>.ts.
import { boot } from './kit/runtime';

boot(import.meta.glob('./parts/*.{ts,tsx}'));
