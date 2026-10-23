// Pictures of den-kit's tab, for the AI (the ScreenCapture interface) in a
// browser: the person lets the AI see the screen (a click; the browser asks to
// share this tab, and shows that it is shared), and den-kit keeps the tab's
// video and takes a frame when the AI looks. A Capture Handle check makes sure
// it is den-kit's own tab.
import { randomId } from '../src/work/schema.ts';
import { cropRect } from '../src/ai/seeing.ts';
import type { ScreenCapture } from '../src/host/index.ts';

const supported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

export function tabCapture(): ScreenCapture {
  let track: MediaStreamTrack | null = null;
  let video: HTMLVideoElement | null = null;
  const ended = new Set<() => void>();
  const release = () => {
    track = null;
    if (video) {
      video.srcObject = null;
      video = null;
    }
  };
  async function frame(): Promise<ImageBitmap> {
    const Capture = (
      globalThis as unknown as {
        ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };
      }
    ).ImageCapture;
    if (Capture && track) {
      try {
        return await new Capture(track).grabFrame();
      } catch {
        /* fall back to the video */
      }
    }
    if (!video || !video.videoWidth) throw new Error('No picture from the shared tab yet.');
    return createImageBitmap(video);
  }
  return {
    source: 'tab',
    unsupported: supported()
      ? null
      : 'This browser cannot share a tab (Chrome or Edge on a computer can).',
    asking: 'Choose “this tab” in the browser’s dialog.',
    title: on =>
      on
        ? 'The AI can see this tab as you see it when it looks (click to stop sharing)'
        : 'Let the AI see the screen as you see it (the browser asks to share this tab)',
    async start() {
      const handle = randomId('den-kit');
      try {
        (
          navigator.mediaDevices as MediaDevices & { setCaptureHandleConfig?(c: unknown): void }
        ).setCaptureHandleConfig?.({ handle, exposeOrigin: false, permittedOrigins: ['*'] });
      } catch {
        /* not in this browser */
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 4 },
          audio: false,
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
          monitorTypeSurfaces: 'exclude',
        } as DisplayMediaStreamOptions);
      } catch (error) {
        const name = (error as { name?: string })?.name;
        return name === 'NotAllowedError'
          ? {
              state: 'refused',
              message: 'Not shared: the AI sees the plugin re-drawn and the patch in words.',
            }
          : {
              state: 'error',
              message: `Could not share the tab: ${error instanceof Error ? error.message : String(error)}`,
            };
      }
      const got = stream.getVideoTracks()[0];
      if (!got) return { state: 'error', message: 'The browser shared no picture.' };
      // Only den-kit's own tab: its capture handle (Chrome) or, without one, a browser tab.
      const own = (
        got as MediaStreamTrack & { getCaptureHandle?(): { handle?: string } | null }
      ).getCaptureHandle?.();
      const surface = (got.getSettings() as { displaySurface?: string }).displaySurface;
      if ((own && own.handle !== handle) || (!own && surface && surface !== 'browser')) {
        got.stop();
        return {
          state: 'refused',
          message:
            'That was not this tab: den-kit only looks at its own tab. Try again and pick “this tab”.',
        };
      }
      got.addEventListener('ended', () => {
        release();
        for (const listener of ended) listener();
      });
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        /* frames still come through ImageCapture */
      }
      track = got;
      video = v;
      return true;
    },
    stop() {
      track?.stop();
      release();
    },
    async picture(rect, maxSide) {
      if (!track) throw new Error('The screen is not shared.');
      const shot = await frame();
      try {
        const c = cropRect(
          { width: shot.width, height: shot.height },
          { width: window.innerWidth, height: window.innerHeight },
          rect,
          maxSide,
        );
        const canvas = new OffscreenCanvas(c.dw, c.dh);
        canvas.getContext('2d')!.drawImage(shot, c.sx, c.sy, c.sw, c.sh, 0, 0, c.dw, c.dh);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        return {
          data: new Uint8Array(await blob.arrayBuffer()),
          mime: 'image/jpeg',
          width: c.dw,
          height: c.dh,
          source: 'tab',
        };
      } finally {
        shot.close();
      }
    },
    onEnded(listener) {
      ended.add(listener);
      return () => ended.delete(listener);
    },
  };
}
