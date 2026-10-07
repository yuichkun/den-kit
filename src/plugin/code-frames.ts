// Code parts (kind 'code') on the page: the pod they come from, and, for each
// part's frame, a way to get a picture of what it shows (a frame from another
// origin cannot be read; the part's page makes the picture itself and sends it).
// capture.ts draws the picture where the frame is.
import type { InjectionKey } from 'vue';
import type { PodSession } from '../pod/pod-session.ts';

export const POD: InjectionKey<PodSession | null> = Symbol('den-kit-pod');
export const CODE_FRAMES = new WeakMap<HTMLIFrameElement, () => Promise<string | null>>();
