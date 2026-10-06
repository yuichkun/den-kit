import { inject, type InjectionKey } from 'vue';
import type { KitSession } from './session.ts';

export const SESSION: InjectionKey<KitSession> = Symbol('den-kit-session');
export function useSession(): KitSession {
  const session = inject(SESSION);
  if (!session) throw new Error('den-kit session is not provided');
  return session;
}

/** Expose a port as a panel knob: one transaction (add widget, cable, place on panel). */
export function exposeIntents(session: KitSession, nodeId: string, portId: string) {
  const doc = session.doc.value;
  const node = doc.nodes[nodeId]!;
  const port = session.catalog.input(node, portId)!;
  const gate = port.type === 'gate';
  const placed = Object.values(doc.nodes).filter(n => n.panel);
  const col = placed.length % 6, row = Math.floor(placed.length / 6);
  const min = port.uiMin ?? port.min ?? 0, max = port.uiMax ?? port.max ?? 1;
  const current = node.values[portId];
  const value = gate ? Boolean(current) : Math.min(max, Math.max(min, Number(current ?? port.default ?? min)));
  const label = `${node.label ?? node.id} ${port.label ?? port.id}`;
  const widget = { type: gate ? 'ui.toggle' : 'ui.knob', label, pos: { x: node.pos.x - 220, y: node.pos.y + 40 }, panel: { x: 16 + col * 96, y: 16 + row * 110, w: 84, h: 96 },
    config: (gate ? {} : { min, max, scale: port.scale ?? 'linear', unit: (port.unit && ['Hz', 's', 'dB', 'oct', 'st', 'mix', 'gain', 'ratio', 'note'].includes(port.unit)) ? port.unit : '' }) as Record<string, string | number>,
    values: { value } };
  return { widget, port };
}
