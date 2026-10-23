import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ScreenShare } from '../../../src/editor/screen-share.ts';
import { windowCapture } from '../../../desktop/page/window-capture.ts';

const rect = { x: 1.4, y: 2.6, width: 160, height: 100 };
afterEach(() => vi.unstubAllGlobals());

function native(capturePage = vi.fn(async () => 'data:image/png;base64,picture')) {
  return { share: new ScreenShare(windowCapture(capturePage)), capturePage };
}

function imageConversion(convertToBlob = async () => new Blob(['image'])) {
  const close = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => new Blob(['captured']) })),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 160, height: 100, close })),
  );
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { drawImage: vi.fn() };
      }
      convertToBlob = convertToBlob;
    },
  );
  return close;
}

describe('screen sharing of the app window', () => {
  it('starts off and does not capture before the person enables sharing', async () => {
    const { share, capturePage } = native();
    expect(share.state.value).toBe('off');
    expect(share.source).toBeNull();
    await expect(share.picture(rect)).rejects.toThrow('The screen is not shared.');
    expect(capturePage).not.toHaveBeenCalled();
  });

  it('captures only after explicit sharing and stops without leaving a source', async () => {
    const close = imageConversion();
    const { share, capturePage } = native();
    expect(await share.start()).toBe(true);
    expect(share.state.value).toBe('on');
    expect(share.source).toBe('shell');
    const picture = await share.picture(rect);
    expect(picture).toMatchObject({ source: 'shell', mime: 'image/jpeg', width: 160, height: 100 });
    expect(picture.data).toEqual(new TextEncoder().encode('image'));
    expect(capturePage).toHaveBeenCalledExactlyOnceWith({ x: 1, y: 3, width: 160, height: 100 });
    expect(close).toHaveBeenCalledOnce();
    share.stop();
    expect(share.state.value).toBe('off');
    expect(share.source).toBeNull();
    await expect(share.picture(rect)).rejects.toThrow('The screen is not shared.');
    expect(capturePage).toHaveBeenCalledOnce();
  });

  it('discards an in-flight capture when sharing stops, even if enabled again', async () => {
    let resolveCapture!: (url: string) => void;
    const capturePage = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveCapture = resolve;
        }),
    );
    const { share } = native(capturePage);
    const fetchImage = vi.fn();
    vi.stubGlobal('fetch', fetchImage);
    await share.start();
    const picture = share.picture(rect);
    const rejected = expect(picture).rejects.toThrow('The screen is not shared.');
    share.stop();
    await share.start();
    resolveCapture('data:image/png;base64,old-capture');
    await rejected;
    expect(fetchImage).not.toHaveBeenCalled();
    expect(share.state.value).toBe('on');
    expect(share.source).toBe('shell');
  });

  it('also discards a captured picture if sharing stops while it is converted', async () => {
    let resolveConversion!: (blob: Blob) => void;
    let conversionStarted!: () => void;
    const started = new Promise<void>(resolve => {
      conversionStarted = resolve;
    });
    const close = imageConversion(() => {
      conversionStarted();
      return new Promise<Blob>(resolve => {
        resolveConversion = resolve;
      });
    });
    const { share } = native();
    await share.start();
    const picture = share.picture(rect);
    const rejected = expect(picture).rejects.toThrow('The screen is not shared.');
    await started;
    share.stop();
    resolveConversion(new Blob(['image']));
    await rejected;
    expect(close).toHaveBeenCalledOnce();
    expect(share.source).toBeNull();
  });
});

describe('without a host that takes pictures', () => {
  it('says sharing is not possible and never starts', async () => {
    const share = new ScreenShare(null);
    expect(share.state.value).toBe('unsupported');
    expect(await share.start()).toBe(false);
    expect(share.source).toBeNull();
  });

  it('still takes injected pictures (tests)', async () => {
    const share = new ScreenShare(null);
    const picture = {
      data: new Uint8Array([1]),
      mime: 'image/png' as const,
      width: 160,
      height: 100,
      source: 'tab' as const,
    };
    share.stub = vi.fn(async () => picture);
    expect(share.source).toBe('tab');
    expect(await share.picture(rect)).toBe(picture);
  });
});
