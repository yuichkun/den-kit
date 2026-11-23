// The development host's share server (dev/share-server.ts): a link's page head holds only
// its outside, as apps that unfurl links read it, and a link only for some people asks not
// to be listed.
import { describe, expect, it } from 'vite-plus/test';
import { outsideHead, readPreview } from '../../../dev/share-server.ts';

const face = {
  outside: 'poster' as const,
  reach: 'public' as const,
  title: 'Lullaby Box',
  line: 'A small music box.',
  from: 'Maker',
  kind: 'Instrument' as const,
  color: '#d4a73a',
  to: '',
  note: '',
};
const page = 'https://share.example/w/abc/';
const media = { image: true, clip: null, type: '' };
const read = (head: string) => readPreview(`<html><head>${head}</head><body></body></html>`, page);

describe('a link page head', () => {
  it('reads back as the poster says, with its picture, color and large card', () => {
    const p = read(outsideHead(face, page, media));
    expect(p).toMatchObject({
      site: 'den-kit',
      title: 'Lullaby Box',
      description: 'An instrument by Maker. A small music box.',
      image: `${page}outside.png`,
      color: '#d4a73a',
      card: 'summary_large_image',
      robots: null,
      video: null,
    });
  });

  it('keeps who it is for and the note out of the head', () => {
    const head = outsideHead(
      { ...face, outside: 'inner', reach: 'person', to: 'Friend', note: 'Try the low keys.' },
      page,
      media,
    );
    expect(head).not.toContain('Friend');
    expect(head).not.toContain('low keys');
    expect(head).not.toContain('Lullaby Box');
    expect(read(head)).toMatchObject({
      title: 'Something from Maker',
      robots: 'noindex, nofollow',
    });
  });

  it('asks not to be listed for people with the link, and not for anyone', () => {
    expect(read(outsideHead({ ...face, reach: 'link' }, page, media)).robots).toBe(
      'noindex, nofollow',
    );
    expect(read(outsideHead(face, page, media)).robots).toBeNull();
  });

  it('says the sound outside is a video page with its clip', () => {
    const p = read(
      outsideHead({ ...face, outside: 'sound' }, page, {
        image: true,
        clip: 'clip.mp4',
        type: 'video/mp4',
      }),
    );
    expect(p.type).toBe('video.other');
    expect(p.video).toEqual({ url: `${page}clip.mp4`, type: 'video/mp4' });
  });

  it('shows the plain outside as a playable build shows it today', () => {
    const p = read(outsideHead({ ...face, outside: 'plain' }, page, { ...media, image: false }));
    expect(p).toMatchObject({ title: 'den-kit player', image: null, description: '', card: null });
  });

  it('escapes what people wrote', () => {
    const head = outsideHead({ ...face, title: '"><script>x</script>' }, page, media);
    expect(head).not.toContain('<script>');
    expect(read(head).title).toBe('"><script>x</script>');
  });
});
