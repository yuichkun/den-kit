// Pictures of den-kit as the person sees it (U8b). In a browser: the person
// lets the AI see the screen (a click; the browser asks to share this tab, and
// shows that it is shared), den-kit keeps the tab's video and takes a frame
// when the AI looks; a Capture Handle check makes sure it is den-kit's own tab.
// In a desktop shell, sharing also starts off and needs the person's explicit
// click. Capturing den-kit's own window needs no OS permission, but stopping
// sharing prevents new captures and discards pictures still being prepared.
// Nothing leaves the page except the pictures sent to the AI with a request.
import { ref } from 'vue';
import { randomId } from '../core/schema.ts';
import { cropRect } from '../ai/seeing.ts';

export type ShareState = 'off' | 'asking' | 'on' | 'unsupported' | 'refused' | 'error';
/** A picture of the page: JPEG (screens are photos to compress, and a tool result carries at most 2 MB). */
export interface Picture {
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  source: 'tab' | 'shell';
}
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** What a desktop shell offers den-kit (Electron: webContents.capturePage through a preload bridge). */
export interface ShellCapture {
  capturePage(rect: PageRect): Promise<string>;
}

const shell = (): ShellCapture | null => {
  const s = (globalThis as { denKitShell?: Partial<ShellCapture> }).denKitShell;
  return s && typeof s.capturePage === 'function' ? (s as ShellCapture) : null;
};

export class ScreenShare {
  readonly state = ref<ShareState>('off');
  readonly message = ref('');
  /** Tests (and the shell): pictures come from here instead of the tab's video. */
  stub: ((rect: PageRect, maxSide: number) => Promise<Picture>) | null = null;
  private track: MediaStreamTrack | null = null;
  private video: HTMLVideoElement | null = null;
  private captureEpoch = 0;

  constructor() {
    if (!shell() && !ScreenShare.supported()) {
      this.state.value = 'unsupported';
      this.message.value = 'This browser cannot share a tab (Chrome or Edge on a computer can).';
    }
  }
  static supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function'
    );
  }

  /** Where pictures come from now (null: nowhere: the person has not shared the screen). */
  get source(): 'tab' | 'shell' | null {
    return this.stub
      ? 'tab'
      : this.state.value !== 'on'
        ? null
        : shell()
          ? 'shell'
          : this.track
            ? 'tab'
            : null;
  }

  /** Enable sharing from an explicit click; browsers ask for this tab. */
  async start(): Promise<boolean> {
    if (this.source) return true;
    if (shell()) {
      this.captureEpoch++;
      this.state.value = 'on';
      this.message.value = '';
      return true;
    }
    if (!ScreenShare.supported()) {
      this.state.value = 'unsupported';
      return false;
    }
    this.state.value = 'asking';
    this.message.value = 'Choose “this tab” in the browser’s dialog.';
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
      this.state.value = name === 'NotAllowedError' ? 'refused' : 'error';
      this.message.value =
        name === 'NotAllowedError'
          ? 'Not shared: the AI sees the plugin re-drawn and the patch in words.'
          : `Could not share the tab: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      this.state.value = 'error';
      this.message.value = 'The browser shared no picture.';
      return false;
    }
    // Only den-kit's own tab: its capture handle (Chrome) or, without one, a browser tab.
    const got = (
      track as MediaStreamTrack & { getCaptureHandle?(): { handle?: string } | null }
    ).getCaptureHandle?.();
    const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
    if ((got && got.handle !== handle) || (!got && surface && surface !== 'browser')) {
      track.stop();
      this.state.value = 'refused';
      this.message.value =
        'That was not this tab: den-kit only looks at its own tab. Try again and pick “this tab”.';
      return false;
    }
    track.addEventListener('ended', () => this.ended());
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* frames still come through ImageCapture */
    }
    this.track = track;
    this.video = video;
    this.state.value = 'on';
    this.message.value = '';
    return true;
  }

  /** Stop sharing (the browser's "Stop sharing" ends it too). */
  stop() {
    this.track?.stop();
    this.ended();
  }

  private ended() {
    this.captureEpoch++;
    this.track = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.state.value = shell() || ScreenShare.supported() ? 'off' : 'unsupported';
    this.message.value = '';
  }

  /** A picture of a part of the page (CSS pixels), as the person sees it, at most maxSide pixels on its long side. */
  async picture(rect: PageRect, maxSide = 1280): Promise<Picture> {
    if (this.stub) return this.stub(rect, maxSide);
    const s = shell();
    if (s) {
      if (this.state.value !== 'on') throw new Error('The screen is not shared.');
      const epoch = this.captureEpoch;
      const url = await s.capturePage(roundRect(rect));
      this.requireCapture(epoch);
      const picture = await fromDataUrl(url, maxSide, 'shell');
      this.requireCapture(epoch);
      return picture;
    }
    if (!this.track) throw new Error('The screen is not shared.');
    const frame = await this.frame();
    try {
      const c = cropRect(
        { width: frame.width, height: frame.height },
        { width: window.innerWidth, height: window.innerHeight },
        rect,
        maxSide,
      );
      const canvas = new OffscreenCanvas(c.dw, c.dh);
      canvas.getContext('2d')!.drawImage(frame, c.sx, c.sy, c.sw, c.sh, 0, 0, c.dw, c.dh);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        mime: 'image/jpeg',
        width: c.dw,
        height: c.dh,
        source: 'tab',
      };
    } finally {
      frame.close();
    }
  }

  private requireCapture(epoch: number) {
    if (this.state.value !== 'on' || this.captureEpoch !== epoch)
      throw new Error('The screen is not shared.');
  }

  private async frame(): Promise<ImageBitmap> {
    const Capture = (
      globalThis as unknown as {
        ImageCapture?: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> };
      }
    ).ImageCapture;
    if (Capture && this.track) {
      try {
        return await new Capture(this.track).grabFrame();
      } catch {
        /* fall back to the video */
      }
    }
    if (!this.video || !this.video.videoWidth)
      throw new Error('No picture from the shared tab yet.');
    return createImageBitmap(this.video);
  }
}

const roundRect = (r: PageRect): PageRect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.max(1, Math.round(r.width)),
  height: Math.max(1, Math.round(r.height)),
});

async function fromDataUrl(
  url: string,
  maxSide: number,
  source: Picture['source'],
): Promise<Picture> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k)),
      h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mime: 'image/jpeg',
      width: w,
      height: h,
      source,
    };
  } finally {
    bitmap.close();
  }
}
