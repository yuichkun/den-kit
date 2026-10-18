// Render the existing geometric logo with Chromium; macOS iconutil assembles the ICNS.
import { _electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'den-kit-icons-'));
const iconset = join(temp, 'icon.iconset');
mkdirSync(iconset);
writeFileSync(
  join(temp, 'main.cjs'),
  "const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true}});w.loadURL('about:blank');});",
);
const runtime = await _electron.launch({ args: [join(temp, 'main.cjs')] });
try {
  const page = await runtime.firstWindow();
  const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8');
  for (const [size, name] of [
    [16, '16x16'],
    [32, '16x16@2x'],
    [32, '32x32'],
    [64, '32x32@2x'],
    [128, '128x128'],
    [256, '128x128@2x'],
    [256, '256x256'],
    [512, '256x256@2x'],
    [512, '512x512'],
    [1024, '512x512@2x'],
  ] as const) {
    const data = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d')!.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1]!;
      },
      { svg, size },
    );
    writeFileSync(join(iconset, `icon_${name}.png`), Buffer.from(data, 'base64'));
    if (size === 1024) writeFileSync(join(root, 'build/icon.png'), Buffer.from(data, 'base64'));
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')]);
} finally {
  await runtime.close();
  rmSync(temp, { recursive: true, force: true });
}
