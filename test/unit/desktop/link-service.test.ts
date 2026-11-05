import { afterEach, describe, expect, it } from 'vite-plus/test';
import { LinkService, linkCommand } from '../../../desktop/link-service.ts';

const state = {
  enabled: false,
  peers: 0,
  tempo: 120,
  beat: 0,
  phase: 0,
  playing: false,
  startStopSync: false,
  timeUs: 1000,
  startTimeUs: 0,
  transportTimeUs: 0,
};
const services: LinkService[] = [];
const service = (source: string) => {
  const instance = new LinkService(process.execPath, ['-e', source]);
  services.push(instance);
  return instance;
};
afterEach(() => {
  for (const instance of services.splice(0)) instance.close();
});

describe('native Link process boundary', () => {
  it('rejects malformed controls before starting a process', () => {
    for (const value of [
      null,
      {},
      { type: 'enable', value: 1 },
      { type: 'tempo', value: NaN },
      { type: 'tempo', value: 1000 },
      { type: 'tempo', value: '120\n2 enable 1' },
      { type: 'play\n2 enable', value: true },
    ])
      expect(() => linkCommand(value)).toThrow();
    expect(linkCommand({ type: 'tempo', value: 121.25 })).toBe('tempo 121.25');
    expect(linkCommand({ type: 'sync', value: false })).toBe('sync 0');
  });

  it('correlates replies across concurrent status and explicit controls', async () => {
    const instance = service(
      `const rl = require('node:readline').createInterface({input:process.stdin}); rl.on('line', line => { const [id, type, value] = line.split(' '); const state = ${JSON.stringify(state)}; if(type==='tempo') state.tempo=Number(value); process.stdout.write(JSON.stringify({id:Number(id),ok:true,state})+'\\n'); });`,
    );
    const replies = await Promise.all([
      instance.request({ type: 'status' }),
      instance.request({ type: 'tempo', value: 135 }),
    ]);
    expect(replies.map(s => s.tempo)).toEqual([120, 135]);
  });

  it('rejects invalid native output instead of feeding it to audio', async () => {
    const instance = service(
      `process.stdin.once('data', () => process.stdout.write(JSON.stringify({id:1,ok:true,state:{tempo:'bad'}})+'\\n'));`,
    );
    await expect(instance.request({ type: 'status' })).rejects.toThrow('invalid state');
  });

  it('settles pending calls on native exit and can restart', async () => {
    const instance = service("process.stdin.once('data', () => process.exit(1));");
    await expect(instance.request({ type: 'status' })).rejects.toThrow('disconnected');
    await expect(instance.request({ type: 'status' })).rejects.toThrow('disconnected');
  });

  it('closing cancels outstanding work', async () => {
    const instance = service('process.stdin.resume();');
    const pending = instance.request({ type: 'status' });
    const rejected = expect(pending).rejects.toThrow('closed');
    instance.close();
    await rejected;
  });
});
