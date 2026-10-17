import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Whether `ps -axo pid=,args=` output shows a packaged den-kit or the Electron staging build. */
export function denKitRunning(processes: string): boolean {
  return processes.split('\n').some(line => {
    const command = line.replace(/^\s*\d+\s+/, '');
    return /\/Contents\/MacOS\/den-kit(?:\s|$)/.test(command)
      || (/\/Contents\/MacOS\/Electron(?:\s|$)/.test(command) && /(?:^|\/)\.desktop-build\/app(?:\s|$)/.test(command));
  });
}
export const listProcesses = () => execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

/** Delete only den-kit's default macOS profile, never build outputs or source. */
export function cleanDesktopData(options: {
  home: string;
  platform: NodeJS.Platform;
  dryRun?: boolean;
  processList: () => string;
}) {
  if (options.platform !== 'darwin') throw new Error('Desktop cleanup currently supports macOS only.');
  const directory = join(options.home, 'Library', 'Application Support', 'den-kit');
  if (options.dryRun) return { directory, removed: false };
  // Failure to inspect processes must prevent deletion.
  if (denKitRunning(options.processList())) throw new Error('Quit den-kit before cleaning its data. No data was deleted.');
  if (!existsSync(directory)) return { directory, removed: false };
  if (lstatSync(directory).isSymbolicLink()) throw new Error('The den-kit data directory is a symbolic link. No data was deleted.');
  rmSync(directory, { recursive: true });
  return { directory, removed: true };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run desktop:clean [-- --dry-run]');
    if (process.env.KIT_DESKTOP_USER_DATA) throw new Error('Unset KIT_DESKTOP_USER_DATA before cleaning the default den-kit profile.');
    const result = cleanDesktopData({
      home: homedir(), platform: process.platform, dryRun: args.includes('--dry-run'),
      processList: listProcesses,
    });
    console.log(`${args.includes('--dry-run') ? 'Would delete' : result.removed ? 'Deleted' : 'No data found at'}: ${result.directory}`);
    if (!args.includes('--dry-run') && result.removed) console.log('ChatGPT sign-in, the autosaved work, conversations, assets, project disks, settings, and caches were removed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
