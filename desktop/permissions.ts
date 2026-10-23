import { APP_ORIGIN } from './renderer-server.ts';
import type { Device } from './sandbox.ts';

/** den-kit's own page: the devices and features its screens use. */
export function allowedPermission(url: string, name: string, mainFrame: boolean): boolean {
  if (!mainFrame) return false;
  try {
    return (
      new URL(url).origin === APP_ORIGIN &&
      ['media', 'midi', 'persistent-storage', 'clipboard-sanitized-write', 'fullscreen'].includes(
        name,
      )
    );
  } catch {
    return false;
  }
}

/** A work's code part: only the devices the person allowed for that work (microphone, camera, MIDI). */
export function workPermission(
  devices: readonly Device[],
  name: string,
  mediaTypes: readonly string[] = [],
): boolean {
  // Electron asks for midiSysex for every Web MIDI request, SysEx or not.
  if (name === 'midi' || name === 'midiSysex') return devices.includes('midi');
  if (name !== 'media') return false;
  const wanted = mediaTypes.length ? mediaTypes : ['audio', 'video'];
  return wanted.every(t =>
    t === 'audio' ? devices.includes('microphone') : t === 'video' && devices.includes('camera'),
  );
}
