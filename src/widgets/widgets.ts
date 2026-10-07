// The plugin's controls as framework-free Web Components (see base.ts for how
// they talk and how they are styled), one module per kind.
import { DkKnob } from './knob.ts';
import { DkSlider } from './slider.ts';
import { DkToggle } from './toggle.ts';
import { DkXy } from './xy.ts';
import { DkKeyboard } from './keyboard.ts';
import { DkScope } from './display.ts';

export { DkKnob, DkSlider, DkToggle, DkXy, DkKeyboard, DkScope };

export function defineWidgets() {
  const define = (name: string, ctor: CustomElementConstructor) => { if (!customElements.get(name)) customElements.define(name, ctor); };
  define('dk-knob', DkKnob); define('dk-slider', DkSlider); define('dk-toggle', DkToggle); define('dk-xy', DkXy); define('dk-keyboard', DkKeyboard); define('dk-scope', DkScope);
}
