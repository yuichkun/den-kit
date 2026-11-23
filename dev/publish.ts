// The development host's links (Host.publish): the share server that `vp run dev` starts
// (share-server.ts), called from the editor's page. A link's upload is one ZIP: the face,
// the outside's picture and clip, and the playable build under build/.
import type { LinkFace, LinkPreview, Publish, PublishedLink, WorkRef } from '../src/host/index.ts';
import { writeZip, type ZipEntry } from '../src/work/zip.ts';

function upload(work: WorkRef, face: LinkFace, build: Record<string, Uint8Array> | null): Blob {
  const { image, clip, ...words } = face;
  const entries: ZipEntry[] = [
    {
      path: 'face.json',
      data: new TextEncoder().encode(
        JSON.stringify({
          ...words,
          work: work.id,
          name: work.name,
          clipSeconds: clip?.seconds ?? 0,
        }),
      ),
    },
  ];
  if (image) entries.push({ path: 'outside.png', data: image });
  if (clip)
    entries.push({ path: clip.type.includes('mp4') ? 'clip.mp4' : 'clip.webm', data: clip.bytes });
  for (const [path, data] of Object.entries(build ?? {}))
    entries.push({ path: `build/${path}`, data });
  return new Blob([writeZip(entries) as BlobPart], { type: 'application/zip' });
}

export function devPublish(url: string): Publish {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${url}${path}`, init);
    const body = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `The share server answered ${res.status}.`);
    return body;
  };
  const zip = { 'content-type': 'application/zip' };
  return {
    lab: `${url}/lab`,
    create: (work, build, face) =>
      call<PublishedLink>('/api/links', {
        method: 'POST',
        headers: zip,
        body: upload(work, face, build),
      }),
    preview: face =>
      call<LinkPreview>('/api/preview', {
        method: 'POST',
        headers: zip,
        body: upload({ id: '', name: '' }, face, null),
      }),
    links: work =>
      call<PublishedLink[]>(
        `/api/links?${new URLSearchParams({ work: work.id, name: work.name })}`,
      ),
    stop: async link => {
      await call(`/api/links/${encodeURIComponent(link)}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    },
  };
}
