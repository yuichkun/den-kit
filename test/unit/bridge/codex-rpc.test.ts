// JSON-RPC over JSON lines: what a child process can do to the stream, and that
// every request settles.
import { describe, expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { RpcClosed, RpcError, RpcPeer, RpcTimeout } from '../../../bridge/codex/rpc.ts';
import type { RpcNotification, RpcRequest } from '../../../bridge/codex/protocol.ts';

function pair(options: { maxLineChars?: number; output?: Writable } = {}) {
  const input = new PassThrough();
  const written: string[] = [];
  const output = options.output ?? new Writable({ write(chunk, _enc, cb) { written.push(chunk.toString()); cb(); } });
  const requests: RpcRequest[] = [], notifications: RpcNotification[] = [], malformed: string[] = [], closed: string[] = [];
  const peer = new RpcPeer(input, output, {
    onRequest: r => requests.push(r), onNotification: n => notifications.push(n),
    onMalformed: (_line, reason) => malformed.push(reason), onClose: reason => closed.push(reason),
  }, { maxLineChars: options.maxLineChars });
  const sent = () => written.join('').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
  return { input, peer, requests, notifications, malformed, closed, sent };
}
const tick = () => new Promise(r => setTimeout(r, 5));

describe('RpcPeer', () => {
  it('pairs replies with requests by id and omits "jsonrpc"', async () => {
    const { input, peer, sent } = pair();
    const a = peer.request('initialize', { x: 1 });
    const b = peer.request('model/list');
    await tick();
    expect(sent()).toEqual([{ id: 1, method: 'initialize', params: { x: 1 } }, { id: 2, method: 'model/list' }]);
    input.write('{"id":2,"result":{"data":[]}}\n{"id":1,"result":{"ok":true}}\n');
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ data: [] });
  });

  it('reassembles lines split anywhere, including inside a UTF-8 character, and accepts CRLF', async () => {
    const { input, peer, notifications } = pair();
    void peer;
    const line = Buffer.from('{"method":"item/agentMessage/delta","params":{"delta":"Filter wobble — café"}}\r\n');
    const cut = line.indexOf(0xe2) + 1; // inside the three-byte em dash
    input.write(line.subarray(0, cut)); await tick();
    input.write(line.subarray(cut, cut + 7)); await tick();
    input.write(line.subarray(cut + 7));
    await tick();
    expect(notifications).toEqual([{ method: 'item/agentMessage/delta', params: { delta: 'Filter wobble — café' } }]);
  });

  it('skips blank and malformed lines and keeps going', async () => {
    const { input, peer, malformed, notifications } = pair();
    const r = peer.request('account/read');
    input.write('\n\nnot json\n[1,2]\n{"neither":1}\n{"id":{"x":1},"method":"a"}\n{"method":"warning","params":{}}\n{"id":1,"result":{"account":null}}\n');
    expect(await r).toEqual({ account: null });
    expect(malformed).toEqual(['not JSON', 'not an object', 'neither a request, a notification nor a response', 'request id is not a string or number']);
    expect(notifications).toHaveLength(1);
    expect(peer.stats.malformed).toBe(4);
  });

  it('drops an over-long line without losing the next ones', async () => {
    const { input, notifications, malformed } = pair({ maxLineChars: 1000 });
    input.write(`{"method":"x","params":"${'a'.repeat(600)}`);
    input.write(`${'b'.repeat(600)}"}\n{"method":"after"}\n`);
    await tick();
    expect(malformed[0]).toMatch(/longer than 1000/);
    expect(notifications.map(n => n.method)).toEqual(['after']);
  });

  it('routes server requests and writes replies and errors', async () => {
    const { input, peer, requests, sent } = pair();
    input.write('{"id":"srv-1","method":"item/tool/call","params":{"tool":"kit_get_patch"}}\n{"id":7,"method":"currentTime/read","params":{}}\n');
    await tick();
    expect(requests.map(r => [r.id, r.method])).toEqual([['srv-1', 'item/tool/call'], [7, 'currentTime/read']]);
    peer.respond('srv-1', { success: true, contentItems: [] });
    peer.respondError(7, -32601, 'nope');
    await tick();
    expect(sent()).toEqual([{ id: 'srv-1', result: { success: true, contentItems: [] } }, { id: 7, error: { code: -32601, message: 'nope' } }]);
  });

  it('turns error replies into RpcError and ignores late or unknown replies', async () => {
    const { input, peer } = pair();
    const r = peer.request('turn/steer', {});
    input.write('{"error":{"code":-32600,"message":"no active turn to steer"},"id":1}\n{"id":99,"result":{}}\n');
    const error = await r.catch((e: unknown) => e) as RpcError;
    expect(error).toBeInstanceOf(RpcError);
    expect(error.code).toBe(-32600);
    expect(error.message).toBe('no active turn to steer');
    expect(peer.stats.lateReplies).toBe(1);
  });

  it('times a request out and drops its late reply', async () => {
    const { input, peer } = pair();
    const r = peer.request('turn/interrupt', {}, { timeoutMs: 20 });
    await expect(r).rejects.toBeInstanceOf(RpcTimeout);
    input.write('{"id":1,"result":{}}\n');
    await tick();
    expect(peer.stats.lateReplies).toBe(1);
    expect(peer.inFlight).toBe(0);
  });

  it('settles everything when the stream ends, and refuses later requests', async () => {
    const { input, peer, closed } = pair();
    const r = peer.request('thread/start', {});
    input.end();
    await expect(r).rejects.toBeInstanceOf(RpcClosed);
    await expect(peer.request('x')).rejects.toBeInstanceOf(RpcClosed);
    expect(closed).toHaveLength(1);
    peer.respond(1, {}); // dropped, no throw
  });

  it('waits for drain under back-pressure and keeps the order', async () => {
    const chunks: string[] = [];
    let release: (() => void) | null = null;
    const slow = new Writable({ highWaterMark: 8, write(chunk, _enc, cb) { chunks.push(chunk.toString()); release = cb; } });
    const { peer } = pair({ output: slow });
    for (let i = 0; i < 5; i++) peer.notify('n', { i });
    for (let i = 0; i < 10 && chunks.length < 5; i++) { await tick(); const r = release as (() => void) | null; release = null; r?.(); }
    await tick();
    expect(chunks.map(c => JSON.parse(c).params.i)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a write error (child gone) closes the peer and rejects pending requests', async () => {
    const broken = new Writable({ write(_chunk, _enc, cb) { cb(new Error('EPIPE')); } });
    const { peer } = pair({ output: broken });
    const r = peer.request('initialize', {});
    await expect(r).rejects.toBeInstanceOf(RpcClosed);
    expect(peer.closed).toBe(true);
  });
});
