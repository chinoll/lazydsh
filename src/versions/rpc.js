// SPDX-License-Identifier: GPL-3.0-only
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';

// Connection Fetch extensions are authenticated and owner-only. Do not expose
// this mutation through an unauthenticated HTTP server or a model-facing tool.
export function registerVersionRpc(connection, handle) {
  const disposers = [];
  try {
    for (const action of ['list', 'regenerate', 'select']) {
      const method = `lazydsh/versions/${action}`;
      disposers.push(connection.fetch.register({
        path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
        async fetch(request) {
          if (request.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/json') {
            return new Response('Expected application/json', { status: 415 });
          }
          let raw;
          try { raw = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
          const parsed = clientRequestSchema.safeParse(raw);
          if (!parsed.success || parsed.data.method !== method) return new Response('Invalid RPC request', { status: 400 });
          let result;
          try { result = { ok: true, value: await handle(action, parsed.data.payload) }; }
          catch (error) {
            result = { ok: false, error: { code: 'lazydsh/versions',
              message: error.userMessage ?? '操作未完成，请刷新后重试。', details: {} } };
          }
          return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result });
        },
      }));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}
