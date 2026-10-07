import { inject, type InjectionKey } from 'vue';
import type { KitSession } from './session.ts';

export const SESSION: InjectionKey<KitSession> = Symbol('den-kit-session');
export function useSession(): KitSession {
  const session = inject(SESSION);
  if (!session) throw new Error('den-kit session is not provided');
  return session;
}
