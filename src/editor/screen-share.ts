// Pictures of den-kit as the person sees it (U8b), for the AI. Sharing starts
// off and needs the person's explicit click; the host takes the pictures
// (src/host, ScreenCapture) and may ask the person first. Stopping sharing
// prevents new pictures and discards those still being prepared. Nothing leaves
// the page except the pictures sent to the AI with a request.
import { ref } from 'vue';
import type { PageRect, Picture, ScreenCapture } from '../host/index.ts';

export type { PageRect, Picture };
export type ShareState = 'off' | 'asking' | 'on' | 'unsupported' | 'refused' | 'error';

const NONE = 'den-kit cannot take pictures of its screen here.';

export class ScreenShare {
  readonly state = ref<ShareState>('off');
  readonly message = ref('');
  /** Tests: pictures come from here instead of the host. */
  stub: ((rect: PageRect, maxSide: number) => Promise<Picture>) | null = null;
  private readonly capture: ScreenCapture | null;
  private epoch = 0;

  constructor(capture: ScreenCapture | null = null) {
    this.capture = capture;
    const why = capture ? capture.unsupported : NONE;
    if (why) {
      this.state.value = 'unsupported';
      this.message.value = why;
    }
    capture?.onEnded(() => this.ended());
  }

  /** Where pictures come from now (null: nowhere: the person has not shared the screen). */
  get source(): 'tab' | 'shell' | null {
    if (this.stub) return 'tab';
    return this.state.value === 'on' && this.capture ? this.capture.source : null;
  }

  /** What the share button says. */
  title(): string {
    if (this.state.value === 'unsupported') return this.message.value;
    return this.capture?.title(this.state.value === 'on') ?? NONE;
  }

  /** Enable sharing from an explicit click. */
  async start(): Promise<boolean> {
    if (this.source) return true;
    if (!this.capture || this.capture.unsupported) {
      this.state.value = 'unsupported';
      return false;
    }
    if (this.capture.asking) {
      this.state.value = 'asking';
      this.message.value = this.capture.asking;
    }
    const started = await this.capture.start();
    if (started !== true) {
      this.state.value = started.state;
      this.message.value = started.message;
      return false;
    }
    this.epoch++;
    this.state.value = 'on';
    this.message.value = '';
    return true;
  }

  /** Stop sharing (the browser's own "Stop sharing" ends it too). */
  stop() {
    this.capture?.stop();
    this.ended();
  }

  private ended() {
    this.epoch++;
    this.state.value = !this.capture || this.capture.unsupported ? 'unsupported' : 'off';
    this.message.value = this.capture?.unsupported ?? (this.capture ? '' : NONE);
  }

  /** A picture of a part of the page (CSS pixels), as the person sees it, at most maxSide pixels on its long side. */
  async picture(rect: PageRect, maxSide = 1280): Promise<Picture> {
    if (this.stub) return this.stub(rect, maxSide);
    if (this.state.value !== 'on' || !this.capture) throw new Error('The screen is not shared.');
    const epoch = this.epoch;
    const wanted = () => this.state.value === 'on' && this.epoch === epoch;
    const picture = await this.capture.picture(rect, maxSide, wanted);
    if (!wanted()) throw new Error('The screen is not shared.');
    return picture;
  }
}
