// Makes what a link preview shows of each work, from the real player on the stage
// (site/stage.html), into out/media/<id>/:
//
//   card.png  the picture (1200×630): the work's screen as its page opens, where
//             its moment ends
//   clip.mp4  the clip (1280×720, H.264 and AAC): the player playing the work's
//             moment, its frames and its sound recorded as they happen
//
//   node prototype/field/make-media.mjs [id,id,...]
//
// Needs the work files from export-works.mjs, and ffmpeg. CHROMIUM_PATH names the
// browser to drive when Playwright's own is not installed.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2]?.split(',');
/** Seconds the clip runs on after the moment, so the last notes ring out. */
const TAIL = 0.8;

const { server, works } = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/** The stage for a work, with the player ready in it. */
async function stage(id, use, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => console.error(`${id} ${use}:`, e.message));
  await page.goto(`${base}/stage.html?w=${id}&for=${use}`);
  await page.waitForSelector('body[data-ready=yes]');
  const frame = page.frames().find(f => f.url().includes(`/w/${id}/`));
  await frame.waitForSelector('[data-testid=player][data-state=ready]', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await frame.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  return { page, frame };
}

try {
  for (const work of works.values()) {
    if (only && !only.includes(work.id)) continue;
    const out = join(here, 'out/media', work.id);
    mkdirSync(out, { recursive: true });

    const card = await stage(work.id, 'card', { width: 1200, height: 630 });
    await card.page.screenshot({ path: join(out, 'card.png') });
    await card.page.close();

    const { page, frame } = await stage(work.id, 'clip', { width: 1280, height: 720 });
    await frame.evaluate(() => window.__player.start());
    await frame.waitForSelector('[data-testid=player][data-state=playing]', { timeout: 30000 });
    await frame.evaluate(() => window.__player.rewind());
    await page.waitForTimeout(1200);
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', async f => {
      frames.push({ t: f.metadata.timestamp, data: f.data });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    await page.waitForTimeout(300);
    const { t0, audio } = await frame.evaluate(async tail => {
      const engine = window.__player.engine;
      const out = new MediaStreamAudioDestinationNode(engine.outAnalyser.context);
      engine.outAnalyser.connect(out);
      const recorder = new MediaRecorder(out.stream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 256000,
      });
      const chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      const stopped = new Promise(resolve => (recorder.onstop = resolve));
      recorder.start();
      const t0 = performance.timeOrigin + performance.now();
      await window.__player.perform();
      await new Promise(resolve => setTimeout(resolve, tail * 1000));
      recorder.stop();
      await stopped;
      engine.outAnalyser.disconnect(out);
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { t0, audio: btoa(text) };
    }, TAIL);
    await cdp.send('Page.stopScreencast');
    await page.close();

    // The frames as they were shown from the moment's start, each held until the next.
    const length = work.moment.seconds + TAIL;
    const relative = frames.map(f => ({ t: f.t - t0 / 1000, data: f.data }));
    const before = relative.filter(f => f.t < 0).at(-1);
    const shown = [
      ...(before ? [{ ...before, t: 0 }] : []),
      ...relative.filter(f => f.t >= 0 && f.t < length),
    ];
    if (!shown.length) throw new Error(`${work.id}: no frames were recorded`);
    const scratch = mkdtempSync(join(tmpdir(), 'clip-'));
    const list = ['ffconcat version 1.0'];
    shown.forEach((f, i) => {
      const file = join(scratch, `f${String(i).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      const from = i === 0 ? 0 : f.t;
      const until = i + 1 < shown.length ? shown[i + 1].t : length;
      list.push(`file '${file}'`, `duration ${(until - from).toFixed(4)}`);
    });
    list.push(`file '${join(scratch, `f${String(shown.length - 1).padStart(5, '0')}.jpg`)}'`);
    writeFileSync(join(scratch, 'frames.txt'), list.join('\n'));
    writeFileSync(join(scratch, 'sound.webm'), Buffer.from(audio, 'base64'));
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(scratch, 'frames.txt'),
      '-i',
      join(scratch, 'sound.webm'),
      '-vf',
      'fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-profile:v',
      'high',
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ar',
      '48000',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-t',
      length.toFixed(3),
      '-movflags',
      '+faststart',
      join(out, 'clip.mp4'),
    ]);
    rmSync(scratch, { recursive: true, force: true });
    console.log(
      `${work.id}: card.png, clip.mp4 (${shown.length} frames over ${length.toFixed(1)} s)`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
