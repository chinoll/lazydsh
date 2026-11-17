// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, BlockAssembler, createToolResultMessage } from '@deepseek-ai/dsh-llm';
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';
import * as Google from 'lazydsh/gemini';
import * as Lazy from 'lazydsh';

const MODEL = 'gemini-3.1-pro-preview';
const USER = { role: 'user', content: [{ type: 'text', text: 'Search, then calculate.' }] };

async function host(t, config = {}, credentials) {
  const ctx = new Context();
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { GEMINI_API_KEY: 'launch-key' } }]));
  if (credentials) ctx.provide('credentials', credentials);
  ctx.plugin(LlmRuntime);
  ctx.provide('settings', {});
  ctx.plugin(Lazy);
  const fiber = ctx.plugin(Google, config);
  t.after(() => ctx.fiber.dispose());
  for (let i = 0; i < 50 && !ctx.get('llm')?.listProviders().length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(ctx.llm.listProviders().some(provider => provider.id === 'google-native'));
  return { ctx, fiber };
}

test('real Cordis + DSH exposes native provider, model selector levels and credential directory', async t => {
  const { ctx } = await host(t);
  assert.equal((await ctx.llm.listModels('google-native')).length, 3);
  assert.deepEqual((await ctx.llm.resolveModelInfo('google-native', MODEL)).reasoning.efforts.map(item => item.id), ['low', 'medium', 'high']);
  assert.equal(ctx.llm.listConfigurableProviders()[0].settingsNs, 'llm-google-native');
  assert.deepEqual(ctx.llm.listConfigurableProviders()[0].settingsPath, []);
  await assert.rejects(() => ctx.llm.prepareCall({ provider: 'google-native', model: MODEL, reasoningEffort: 'off' }), { code: 'UNSUPPORTED_REASONING_EFFORT' });
});

test('real DSH call, local HTTP, persistence, tool execution and next call complete the search flow', async t => {
  const requests = [];
  const nativeParts = [
    { toolCall: { id: 'search-1', toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['example'] } }, thoughtSignature: 'search-signature' },
    { toolResponse: { id: 'search-1', toolType: 'GOOGLE_SEARCH_WEB', response: { search_suggestions: '<div>example</div>' } }, thoughtSignature: 'result-signature' },
    { functionCall: { id: 'calculate-1', name: 'calculate', args: { value: 21 } }, thoughtSignature: 'function-signature' },
  ];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const data of req) body += data;
    requests.push({ headers: req.headers, body: JSON.parse(body), url: req.url });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const parts = requests.length === 1 ? nativeParts : [{ text: 'The answer is 42.', thoughtSignature: 'answer-signature' }];
    res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP',
      groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org', title: 'Example' } }], webSearchQueries: ['example'] },
    }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 20, totalTokenCount: 80 } })}\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const refs = [];
  const { ctx } = await host(t, { baseURL: `http://127.0.0.1:${server.address().port}/v1beta`, models: [{ id: MODEL, reasoning: 'medium' }] }, {
    resolve: async ref => { refs.push(ref); return { value: 'stored-key' }; },
  });
  const config = { provider: 'google-native', model: MODEL };
  const first = await ctx.llm.prepareCall(config);
  assert.equal(first.config.reasoningEffort, 'medium');
  const tools = [{ name: 'calculate', description: 'Double a number', parameters: { type: 'object', properties: { value: { type: 'number' } } } }];
  const assembled = new BlockAssembler();
  for await (const event of first.stream({ ...first.config, messages: [USER], tools })) assembled.push(event);
  assert.equal(assembled.finish.kind, 'tool-calls');
  const persisted = JSON.parse(JSON.stringify(assembled.message({ ...config, replayState: assembled.replayState })));
  const call = persisted.content.find(block => block.type === 'tool-call');
  const value = JSON.parse(call.arguments).value * 2;
  const second = await ctx.llm.prepareCall({ ...config, reasoningEffort: 'high' });
  const final = new BlockAssembler();
  for await (const event of second.stream({ ...second.config, tools, messages: [USER, persisted,
    createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: String(value) }], isError: false }),
  ] })) final.push(event);
  assert.equal(final.finish.kind, 'stop');
  assert.match(final.blocks().map(block => block.text).join(''), /answer is 42/);
  assert.deepEqual(requests[1].body.contents[1].parts, nativeParts);
  assert.equal(requests[1].body.contents[2].parts[0].functionResponse.id, 'calculate-1');
  assert.equal(requests[1].body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.equal(requests[0].headers['x-goog-api-key'], 'stored-key');
  assert.match(requests[0].headers['user-agent'], /deepseek-harness/);
  assert.deepEqual(refs, ['GEMINI_API_KEY', 'GEMINI_API_KEY']);
});

test('DSH converts native HTTP errors into one terminal error with structured failure facts', async t => {
  const server = createServer((_req, res) => {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
    res.end(JSON.stringify({ error: { message: 'Temporary rate limit.' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const { ctx } = await host(t, { baseURL: `http://127.0.0.1:${server.address().port}/v1beta` });
  const chunks = [];
  for await (const chunk of ctx.llm.stream({ provider: 'google-native', model: MODEL, messages: [USER] })) chunks.push(chunk);
  assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1);
  assert.equal(chunks.at(-1).reason.kind, 'error');
  assert.equal(chunks.at(-1).reason.failure.code, 'RATE_LIMIT');
  assert.equal(chunks.at(-1).reason.failure.status, 429);
  assert.equal(chunks.at(-1).reason.failure.providerRetryAfterMs, 1000);
});

test('Cordis config changes update native metadata and reject unsupported model generations', async t => {
  const { ctx, fiber } = await host(t, { models: [{ id: MODEL, reasoning: 'low' }] });
  await fiber.update({ models: [{ id: MODEL, reasoning: 'high' }], googleSearch: false });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await ctx.llm.resolveModelInfo('google-native', MODEL)).reasoning.defaultEffort, 'high');
  await assert.rejects(async () => fiber.update({ models: [{ id: 'gemini-2.5-pro' }] }), { code: 'INVALID_CONFIG' });
  assert.equal((await ctx.llm.resolveModelInfo('google-native', MODEL)).reasoning.defaultEffort, 'high');
});
