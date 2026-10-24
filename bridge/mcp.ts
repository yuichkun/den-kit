// den-kit's tools as an MCP server (streamable HTTP, JSON responses), for the
// agent runtime: the runtime gives an MCP server to the sub-agents it starts,
// while tools registered on a conversation stay with that conversation. Each
// call says which agent made it (`_meta.threadId`, the caller's own
// conversation); the bridge runs it in the page that started the request.
//
// Trust model: loopback only, a per-launch bearer token (the runtime reads it
// from its environment, never from a file), and no browser: a request that
// carries an Origin header is refused, so a web page cannot reach it even with
// the token.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolOutput } from './protocol.ts';
import type { ToolSpec } from '../src/ai/llm-spec.ts';

export const MCP_PATH = '/mcp';
/** The environment variable the runtime reads the token from (its config names it). */
export const MCP_TOKEN_ENV = 'DEN_KIT_MCP_TOKEN';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];
/** Tool arguments carry whole files (kit_write_file, kit_write_codebox). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface McpServerOptions {
  token: string;
  tools(): ToolSpec[];
  /** Run a tool for the agent whose conversation is `thread` (undefined when the runtime did not say). */
  call(thread: string | undefined, tool: string, args: unknown): Promise<ToolOutput>;
  version: string;
}

/** An MCP tool result: the text, then the picture (a data: URL becomes an image item). */
export function mcpContent(output: ToolOutput) {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: output.text }];
  const image = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(output.imageDataUrl ?? '');
  if (image) content.push({ type: 'image', data: image[2], mimeType: image[1] });
  return { content, isError: !output.success };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Answers MCP requests at MCP_PATH (`handle` returns false for any other path). */
export function mcpHandler(options: McpServerOptions) {
  return {
    token: options.token,
    handle: (req: IncomingMessage, res: ServerResponse): boolean => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== MCP_PATH) return false;
      const deny = (status: number, message: string) => {
        res.writeHead(status, { 'content-type': 'text/plain' }).end(message);
      };
      if (req.headers.origin !== undefined) return (deny(403, 'not for browsers'), true);
      if (!same(req.headers.authorization ?? '', `Bearer ${options.token}`))
        return (deny(401, 'unauthorized'), true);
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end();
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          deny(413, 'too large');
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on('end', () => {
        if (size > MAX_BODY_BYTES) return;
        let message: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
        try {
          message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          deny(400, 'bad json');
          return;
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          deny(400, 'one JSON-RPC message per request');
          return;
        }
        // Notifications (initialized, cancelled) need no answer.
        if (message.id === undefined || message.id === null) {
          res.writeHead(202).end();
          return;
        }
        const reply = (body: Record<string, unknown>) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }));
        };
        const params = (
          message.params && typeof message.params === 'object' ? message.params : {}
        ) as Record<string, unknown>;
        switch (message.method) {
          case 'initialize': {
            const asked = String(params.protocolVersion ?? '');
            reply({
              result: {
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'den-kit', version: options.version },
              },
            });
            return;
          }
          case 'ping':
            reply({ result: {} });
            return;
          case 'tools/list':
            reply({
              result: {
                tools: options.tools().map(t => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                })),
              },
            });
            return;
          case 'tools/call': {
            const meta = (
              params._meta && typeof params._meta === 'object' ? params._meta : {}
            ) as Record<string, unknown>;
            const thread = typeof meta.threadId === 'string' ? meta.threadId : undefined;
            if (typeof params.name !== 'string') {
              reply({ error: { code: -32602, message: 'tools/call needs a tool name' } });
              return;
            }
            options.call(thread, params.name, params.arguments ?? {}).then(
              output => reply({ result: mcpContent(output) }),
              (error: unknown) =>
                reply({
                  result: mcpContent({
                    success: false,
                    text: error instanceof Error ? error.message : String(error),
                  }),
                }),
            );
            return;
          }
          default:
            reply({
              error: { code: -32601, message: `Method not found: ${String(message.method)}` },
            });
        }
      });
      return true;
    },
  };
}
