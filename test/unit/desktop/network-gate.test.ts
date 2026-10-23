// The pod's way out: BrowserPod reaches the internet through sockets the page
// opens to its portal's /conn. While closed, it gets stand-ins that refuse every
// connection the way the portal does; opening or closing ends the sockets of the
// other state. Every other socket (BrowserPod's start, the dev server's portal,
// den-kit's own) is untouched.
import { describe, expect, it } from 'vite-plus/test';
import { networkGate } from '../../../desktop/page/browserpod.ts';

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  close() {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }
}
type Socket = {
  url: string;
  readyState?: number;
  onmessage: ((e: { target: unknown; data: string }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
  closed?: boolean;
};
const tick = () => new Promise(r => setTimeout(r, 5));
const CONN = 'wss://main.browserportal.io/conn?apiKey=k&localIp=192.168.1.100';

describe("the pod's network", () => {
  it('is closed until den-kit opens it: a connection is refused as the portal refuses one', async () => {
    const scope = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    networkGate(scope);
    const socket = new scope.WebSocket(CONN) as unknown as Socket;
    expect(socket).not.toBeInstanceOf(FakeSocket);
    const heard: Array<Record<string, unknown>> = [];
    socket.onmessage = e => heard.push(JSON.parse(e.data));
    await tick();
    expect(heard).toEqual([{ type: 'init' }]);
    socket.send(
      JSON.stringify({
        type: 'tcpconnect',
        destip: '140.82.112.3',
        destport: 443,
        srcip: '192.168.1.100',
        srcport: 1030,
      }),
    );
    await tick();
    expect(heard.at(-1)).toEqual({
      type: 'tcpdisconnect',
      destip: '192.168.1.100',
      destport: 1030,
      srcip: '140.82.112.3',
      srcport: 443,
    });
    // Name lookups (UDP) go unanswered.
    socket.send(JSON.stringify({ type: 'udp', destip: '8.8.8.8', destport: 53 }));
    await tick();
    expect(heard).toHaveLength(2);
  });

  it('opening it lets real sockets through and ends the stand-ins; closing ends the real ones', () => {
    const scope = { WebSocket: FakeSocket as unknown as typeof WebSocket };
    const setOpen = networkGate(scope);
    const refusing = new scope.WebSocket(CONN) as unknown as Socket;
    let ended = false;
    refusing.onclose = () => (ended = true);
    setOpen(true);
    expect(ended).toBe(true);
    const real = new scope.WebSocket(CONN) as unknown as FakeSocket;
    expect(real).toBeInstanceOf(FakeSocket);
    setOpen(false);
    expect(real.closed).toBe(true);
    // BrowserPod's start, the dev server's portal and den-kit's own sockets are never touched.
    for (const url of [
      'wss://main.browserportal.io/init?apiKey=k',
      'ws://127.0.0.1:5181/',
      'wss://disks.browserpod.io/disks/user.ext2',
    ])
      expect(new scope.WebSocket(url)).toBeInstanceOf(FakeSocket);
    // The class is still the class (BrowserPod compares readyState with WebSocket.OPEN).
    expect(scope.WebSocket.OPEN).toBe(1);
  });
});
