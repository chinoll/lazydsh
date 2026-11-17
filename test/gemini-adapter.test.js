// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BlockAssembler, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { GoogleAdapter, Config } from '../src/gemini/index.js';
import { plainConfig, resolveConfig } from '../src/gemini/config.js';
import { toContents } from '../src/gemini/content.js';

const MODEL = 'gemini-3.1-pro-preview';
const USER = { role: 'user', content: [{ type: 'text', text: '查询资料并计算结果。' }] };
const OPTIONS = { provider: 'google-native', model: MODEL, messages: [USER] };
const TOOL = { name: 'calculate', description: 'Calculate a number', parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } };
const chunk = (parts, extra = {}) => ({ candidates: [{ index: 0, content: { role: 'model', parts }, ...extra }] });
const STOP = chunk([{ text: '完成。' }], { finishReason: 'STOP' });

function sse(events, { fragmented = false, crlf = false } = {}) {
  const nl = crlf ? '\r\n' : '\n';
  const data = new TextEncoder().encode(events.map(item => `data: ${JSON.stringify(item)}${nl}${nl}`).join(''));
  let position = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (position >= data.length) return controller.close();
      const end = fragmented ? Math.min(position + 7, data.length) : data.length;
      controller.enqueue(data.slice(position, end)); position = end;
    },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

function fixture(config = {}, events = [STOP]) {
  const requests = [];
  const adapter = new GoogleAdapter({ config, resolveApiKey: async () => 'test-secret', fetchImpl: async (url, init) => {
    requests.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    return sse(events, { fragmented: true, crlf: true });
  } });
  return { adapter, requests };
}

async function collect(stream) {
  const assembler = new BlockAssembler();
  const chunks = [];
  for await (const chunk of stream) { chunks.push(chunk); assembler.push(chunk); }
  return { chunks, assembler, message: assembler.message({ provider: 'google-native', model: MODEL, replayState: assembler.replayState }) };
}

test('native schema defaults and model metadata expose only supported Gemini 3+ levels', async () => {
  const adapter = new GoogleAdapter({ config: () => plainConfig(Config({})) });
  for (const [model, levels] of [
    ['gemini-3-pro-preview', ['low', 'high']],
    [MODEL, ['low', 'medium', 'high']],
    ['gemini-3-flash-preview', ['minimal', 'low', 'medium', 'high']],
  ]) {
    assert.deepEqual((await adapter.resolveModel('google-native', model)).reasoning.efforts.map(item => item.id), levels);
  }
  for (const id of ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3-pro-image-preview', '../secret']) {
    assert.throws(() => resolveConfig({ models: [{ id }] }), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => resolveConfig({ models: [{ id: MODEL, thinkingLevels: [] }] }), { code: 'INVALID_CONFIG' });
  assert.throws(() => resolveConfig({ models: [{ id: 'gemini-3-pro-preview' }], reasoning: 'medium' }), { code: 'INVALID_CONFIG' });
});

test('thinking level, Google Search, function declarations and attribution reach the native wire', async () => {
  const { adapter, requests } = fixture({ reasoning: 'high', models: [{ id: MODEL }] });
  await collect(adapter.stream({ ...OPTIONS, reasoningEffort: 'medium', tools: [TOOL], maxTokens: 32768, temperature: 0.7, stop: ['END'] }));
  const sent = requests[0];
  assert.equal(sent.url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`);
  assert.equal(sent.headers['x-goog-api-key'], 'test-secret');
  assert.match(sent.headers['user-agent'], /^deepseek-harness\//);
  assert.equal(sent.redirect, 'error');
  assert.deepEqual(sent.body.generationConfig, { thinkingConfig: { thinkingLevel: 'MEDIUM', includeThoughts: true }, maxOutputTokens: 32768, temperature: 0.7, stopSequences: ['END'] });
  assert.deepEqual(sent.body.tools, [{ googleSearch: {} }, { urlContext: {} }, { functionDeclarations: [{ name: TOOL.name, description: TOOL.description, parametersJsonSchema: TOOL.parameters }] }]);
  assert.deepEqual(sent.body.toolConfig, { includeServerSideToolInvocations: true });
  assert.ok(!JSON.stringify(sent.body).includes('thinkingBudget'));
});

test('all advertised Gemini 3/4 thinking levels transmit exactly; defaults preserve provider choice', async () => {
  for (const model of ['gemini-3-pro-preview', MODEL, 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-4-hydrogen']) {
    const { adapter, requests } = fixture({ models: [{ id: model }] });
    const info = await adapter.resolveModel('google-native', model);
    for (const { id } of info.reasoning.efforts) {
      await collect(adapter.stream({ ...OPTIONS, model, reasoningEffort: id }));
      assert.equal(requests.at(-1).body.generationConfig.thinkingConfig.thinkingLevel, id.toUpperCase());
    }
    await collect(adapter.stream({ ...OPTIONS, model }));
    assert.ok(!Object.hasOwn(requests.at(-1).body.generationConfig.thinkingConfig, 'thinkingLevel'));
  }
});

test('future model capabilities can be configured without an adapter release', async () => {
  const { adapter, requests } = fixture({ models: [{ id: 'gemini-5-custom', thinkingLevels: ['high', 'low', 'medium'], reasoning: 'medium' }] });
  assert.deepEqual((await adapter.resolveModel('google-native', 'gemini-5-custom')).reasoning.efforts.map(item => item.id), ['low', 'medium', 'high']);
  await collect(adapter.stream({ ...OPTIONS, model: 'gemini-5-custom' }));
  assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
});

test('unsupported levels and old models fail before HTTP, without silently clamping', async () => {
  const { adapter, requests } = fixture();
  for (const effort of ['off', 'minimal', 'xhigh', 'unknown']) {
    await assert.rejects(() => collect(adapter.stream({ ...OPTIONS, reasoningEffort: effort })), { code: 'UNSUPPORTED_REASONING_EFFORT' });
  }
  await assert.rejects(() => collect(adapter.stream({ ...OPTIONS, model: 'gemini-2.5-pro' })), { code: 'UNKNOWN_MODEL' });
  assert.equal(requests.length, 0);
});

test('search and thought summaries can be disabled, with per-model search overrides', async () => {
  for (const config of [
    { googleSearch: false, includeThoughts: false },
    { googleSearch: true, includeThoughts: false, models: [{ id: MODEL, googleSearch: false }] },
  ]) {
    const { adapter, requests } = fixture(config);
    await collect(adapter.stream({ ...OPTIONS, tools: [TOOL] }));
    assert.equal(requests[0].body.tools.length, 1);
    assert.ok(!requests[0].body.tools[0].googleSearch);
    assert.ok(!requests[0].body.toolConfig);
    assert.equal(requests[0].body.generationConfig.thinkingConfig.includeThoughts, false);
  }
  const { adapter, requests } = fixture({ googleSearch: false, models: [{ id: MODEL, googleSearch: true }] });
  await collect(adapter.stream(OPTIONS));
  assert.deepEqual(requests[0].body.tools, [{ googleSearch: {} }, { urlContext: {} }]);
});

test('a prepared call keeps its endpoint, model limits and search settings across config changes', async () => {
  let config = { baseURL: 'https://old.example/v1beta', googleSearch: true, models: [{ id: MODEL, reasoning: 'low', maxTokens: 32768 }] };
  const { adapter, requests } = fixture(() => config);
  const prepared = await adapter.prepareCall('google-native', MODEL);
  config = { baseURL: 'https://new.example/v1beta', googleSearch: false, models: [{ id: MODEL, reasoning: 'high', maxTokens: 65536 }] };
  await collect(prepared.stream(OPTIONS));
  await collect(adapter.stream(OPTIONS));
  assert.equal(prepared.model.reasoning.defaultEffort, 'low');
  assert.match(requests[0].url, /^https:\/\/old.example/);
  assert.equal(requests[0].body.generationConfig.maxOutputTokens, 32768);
  assert.ok(requests[0].body.tools[0].googleSearch);
  assert.match(requests[1].url, /^https:\/\/new.example/);
  assert.equal(requests[1].body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.ok(!requests[1].body.tools);
});

test('search + parallel local calls + persisted replay preserve every signature and native call ID', async () => {
  const parts = [
    { text: '需要', thought: true, thoughtSignature: 'thought-a' },
    { text: '查询。', thought: true },
    { toolCall: { id: 'search-1', toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['最新资料'] } }, thoughtSignature: 'search-call-signature' },
    { toolResponse: { id: 'search-1', toolType: 'GOOGLE_SEARCH_WEB', response: { search_suggestions: '<div>Search</div>' } }, thoughtSignature: 'search-result-signature' },
    { functionCall: { name: 'calculate', args: { value: 42 }, id: 'function-1' }, thoughtSignature: 'function-signature' },
    { functionCall: { name: 'calculate', args: { value: 43 }, id: 'function-2' } },
    { text: '', thoughtSignature: 'empty-final-signature' },
  ];
  const groundingMetadata = {
    webSearchQueries: ['最新资料'], searchEntryPoint: { renderedContent: '<div>Search suggestions</div>' },
    groundingChunks: [{ web: { uri: 'https://example.org/report', title: '资料' } }],
    groundingSupports: [{ segment: { text: '资料', startIndex: 0, endIndex: 6 }, groundingChunkIndices: [0] }],
  };
  const urlContextMetadata = { urlMetadata: [{ retrievedUrl: 'https://example.org/report', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] };
  const { adapter } = fixture({}, [
    ...parts.map(part => chunk([part])), chunk([], { urlContextMetadata }), chunk([], { finishReason: 'STOP', groundingMetadata }),
    { usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 15, thoughtsTokenCount: 5, totalTokenCount: 120 } },
  ]);
  const { assembler, message, chunks } = await collect(adapter.stream({ ...OPTIONS, tools: [TOOL] }));
  assert.equal(assembler.finish.kind, 'tool-calls');
  assert.equal(message.content.filter(block => block.type === 'tool-call').length, 2);
  assert.equal(message.content[0].text, '需要查询。');
  assert.ok(!message.content.some(block => block.text?.includes('Google Search 来源')));
  assert.deepEqual(assembler.usage, { inputTokens: 70, cacheReadTokens: 30, outputTokens: 20, reasoningTokens: 5, totalTokens: 120 });
  assert.equal(chunks.at(-1).type, 'finish');
  const persisted = JSON.parse(JSON.stringify(message));
  assert.deepEqual(persisted.source.replayState.response.groundingMetadata, groundingMetadata);
  assert.deepEqual(persisted.source.replayState.response.urlContextMetadata, urlContextMetadata);
  const next = await toContents({ ...OPTIONS, messages: [USER, persisted,
    createToolResultMessage({ callId: 'function-1', content: [{ type: 'text', text: '84' }], isError: false }),
    createToolResultMessage({ callId: 'function-2', content: [{ type: 'text', text: 'failed' }], isError: true }),
  ] });
  assert.deepEqual(next.contents[1], { role: 'model', parts });
  assert.deepEqual(next.contents[2].parts, [
    { functionResponse: { name: 'calculate', id: 'function-1', response: { output: '84' } } },
    { functionResponse: { name: 'calculate', id: 'function-2', response: { error: 'failed' } } },
  ]);
});

test('signed text-only and signature-only fragments replay verbatim without duplicate source footer', async () => {
  const parts = [{ text: '你好' }, { text: '🙂' }, { text: '', thoughtSignature: 'signature' }, { thoughtSignature: 'opaque-signature' }];
  const { adapter } = fixture({}, [...parts.map(part => chunk([part])), chunk([], { finishReason: 'STOP' })]);
  const { message } = await collect(adapter.stream(OPTIONS));
  const next = await toContents({ ...OPTIONS, messages: [USER, message, USER] });
  assert.deepEqual(next.contents[1].parts, parts);
  assert.equal(message.content.map(block => block.text).join(''), '你好🙂');
});

test('truncated tool calls are removed with their replay entries by the real DSH assembler', async () => {
  const { adapter } = fixture({}, [chunk([{ text: '处理' }, { functionCall: { name: 'calculate', args: { value: 1 }, id: 'truncated' }, thoughtSignature: 'sig' }], { finishReason: 'MAX_TOKENS' })]);
  const { assembler, message } = await collect(adapter.stream(OPTIONS));
  assert.equal(assembler.finish.kind, 'max-tokens');
  assert.equal(message.content.length, 1);
  const next = await toContents({ ...OPTIONS, messages: [USER, message] });
  assert.deepEqual(next.contents[1].parts, [{ text: '处理' }]);
});

test('replay refuses edited native history and strips another model’s signatures', async () => {
  const { adapter } = fixture({}, [chunk([{ text: '原文', thoughtSignature: 'native-sig' }], { finishReason: 'STOP' })]);
  const { message } = await collect(adapter.stream(OPTIONS));
  const changed = structuredClone(message); changed.content[0].text = 'changed';
  await assert.rejects(() => toContents({ ...OPTIONS, messages: [USER, changed] }), { code: 'INVALID_REPLAY_STATE' });
  const next = await toContents({ ...OPTIONS, model: 'gemini-3-flash-preview', messages: [USER, message] });
  assert.deepEqual(next.contents[1].parts, [{ text: '原文' }]);
});

test('imported function history uses the documented signature sentinel and matches tool results', async () => {
  const assistant = { role: 'assistant', source: { provider: 'other', model: 'other' }, content: [{ type: 'tool-call', id: 'foreign-id', name: 'calculate', arguments: '{"value":5}' }] };
  const next = await toContents({ ...OPTIONS, messages: [USER, assistant, createToolResultMessage({ callId: 'foreign-id', content: [{ type: 'text', text: '10' }], isError: false })] });
  assert.equal(next.contents[1].parts[0].thoughtSignature, 'skip_thought_signature_validator');
  assert.equal(next.contents[2].parts[0].functionResponse.id, 'foreign-id');
});

test('tool calls without native IDs get local IDs but do not invent an API ID on replay', async () => {
  const { adapter } = fixture({}, [chunk([{ functionCall: { name: 'ping' }, thoughtSignature: 'sig' }], { finishReason: 'STOP' })]);
  const { message } = await collect(adapter.stream(OPTIONS));
  const id = message.content[0].id;
  assert.match(id, /^google-/);
  const next = await toContents({ ...OPTIONS, messages: [USER, message, createToolResultMessage({ callId: id, content: [], isError: false })] });
  assert.deepEqual(next.contents[2].parts[0], { functionResponse: { name: 'ping', response: { output: '' } } });
});

test('images use DSH attachment transforms, support tool results, and honor offloaded images', async () => {
  const image = { attachmentId: 'image-1', mediaType: 'image/png', width: 4000, height: 3000, bytes: 7 };
  const reads = [];
  const attachments = { readImageRequest: async (ref, target, signal) => {
    reads.push({ ref, target, signal });
    return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', bytes: 3, width: target.width, height: target.height, attachment: ref };
  } };
  const signal = new AbortController().signal;
  const messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: image }] })];
  const next = await toContents({ ...OPTIONS, messages, signal }, { attachments });
  assert.equal(reads.length, 1); assert.equal(reads[0].signal, signal);
  assert.ok(reads[0].target.width * reads[0].target.height <= 4194304);
  assert.deepEqual(next.contents[0].parts.at(-1), { inlineData: { mimeType: 'image/png', data: 'AQID' } });
  const offloaded = await toContents({ ...OPTIONS, messages: [{ role: 'user', content: [{ type: 'image', attachment: image, offloaded: true }] }] });
  assert.ok(offloaded.contents[0].parts.every(part => part.text));
  await assert.rejects(() => toContents({ ...OPTIONS, messages }), { code: 'UNSUPPORTED_CONTENT' });
});

test('model discovery is paginated, authenticated and filtered to Gemini 3+ text/tool models', async () => {
  const urls = [];
  const adapter = new GoogleAdapter({ resolveApiKey: async () => 'secret', fetchImpl: async (url, init) => {
    urls.push(url); assert.equal(init.headers['x-goog-api-key'], 'secret'); assert.match(init.headers['user-agent'], /deepseek-harness/);
    return Response.json(urls.length === 1 ? { models: [
      { name: `models/${MODEL}`, displayName: 'Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3-pro-image-preview', supportedGenerationMethods: ['generateContent'] },
    ], nextPageToken: 'page 2' } : { models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
  } });
  const models = await adapter.discoverModels();
  assert.deepEqual(models.map(item => item.id), [MODEL, 'gemini-3.8-flash']);
  assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'page 2');
  assert.equal(models[0].contextWindow, 1048576);
});

test('HTTP failures preserve status and retry delay, redact keys, and distinguish failure classes', async () => {
  for (const [status, detail, code] of [
    [401, 'bad test-secret', 'AUTH'], [403, 'forbidden', 'AUTH'],
    [429, 'too many requests', 'RATE_LIMIT'], [503, 'unavailable', 'SERVER'],
    [400, 'input token count exceeds the maximum allowed number of tokens', 'CONTEXT_WINDOW_EXCEEDED'],
  ]) {
    const adapter = new GoogleAdapter({ resolveApiKey: async () => 'test-secret', fetchImpl: async () => Response.json({ error: { message: detail } }, { status, headers: { 'retry-after': '2' } }) });
    await assert.rejects(() => collect(adapter.stream(OPTIONS)), error => {
      assert.equal(error.code, code); assert.equal(error.failure.status, status);
      assert.equal(error.failure.providerRetryAfterMs, 2000); assert.ok(!error.message.includes('test-secret')); return true;
    });
  }
});

test('missing credentials and already-aborted requests never send HTTP', async () => {
  let sent = false;
  const adapter = new GoogleAdapter({ resolveApiKey: async () => { const error = new Error('missing'); error.code = 'MISSING_CREDENTIAL'; throw error; }, fetchImpl: () => { sent = true; } });
  assert.deepEqual(await adapter.listModels('google-native'), []);
  await assert.rejects(() => collect(adapter.stream(OPTIONS)), { code: 'MISSING_CREDENTIAL' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collect(adapter.stream({ ...OPTIONS, signal: controller.signal })), { name: 'AbortError' });
  assert.equal(sent, false);
});

test('empty, blocked, malformed and prematurely closed streams cannot appear successful', async () => {
  for (const [events, code] of [
    [[chunk([], { finishReason: 'STOP' })], 'EMPTY_RESPONSE'],
    [[{ promptFeedback: { blockReason: 'SAFETY' } }], 'CONTENT_FILTER'],
    [[chunk([{ text: 'partial' }], { finishReason: 'SAFETY' })], 'CONTENT_FILTER'],
    [[chunk([{ text: 'partial' }])], 'TRANSPORT'],
    [[{ error: { code: 429, message: 'rate limit' } }], 'RATE_LIMIT'],
    [[chunk([{ functionCall: { name: 'f', args: 'bad' } }], { finishReason: 'STOP' })], 'INVALID_RESPONSE'],
  ]) {
    const { adapter } = fixture({}, events);
    await assert.rejects(() => collect(adapter.stream(OPTIONS)), { code });
  }
  for (const body of ['data: {invalid}\n\n', 'data: {"unfinished":']) {
    const adapter = new GoogleAdapter({ resolveApiKey: async () => 'test', fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    await assert.rejects(() => collect(adapter.stream(OPTIONS)), { code: 'INVALID_RESPONSE' });
  }
});

test('unsafe source URLs and HTML are never emitted as executable markdown/HTML', async () => {
  const { adapter } = fixture({}, [chunk([{ text: 'Answer' }], { finishReason: 'STOP', groundingMetadata: {
    groundingChunks: [
      { web: { uri: 'javascript:alert(1)', title: 'bad' } },
      { web: { uri: 'https://safe.example', title: '<script>alert(1)</script> [x]' } },
      { web: { uri: 'https://safe.example', title: 'duplicate' } },
    ], searchEntryPoint: { renderedContent: '<script>bad()</script>' },
  } })]);
  const { message } = await collect(adapter.stream(OPTIONS));
  const text = message.content.map(block => block.text).join('');
  assert.ok(!text.includes('javascript:')); assert.ok(!text.includes('<script>')); assert.ok(!text.includes('duplicate'));
  assert.equal(text, 'Answer');
  assert.equal(message.source.replayState.response.groundingMetadata.groundingChunks.length, 3);
});

async function server(t, handler) {
  const http = createServer(handler);
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  return `http://127.0.0.1:${http.address().port}/v1beta`;
}

test('real HTTP SSE cancellation and idle timeout close the network request', async t => {
  let connected;
  const ready = new Promise(resolve => { connected = resolve; });
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const baseURL = await server(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(chunk([{ text: 'started' }]))}\n\n`);
    res.on('close', disconnected); connected();
  });
  const adapter = new GoogleAdapter({ config: { baseURL }, resolveApiKey: async () => 'test' });
  const controller = new AbortController();
  const running = collect(adapter.stream({ ...OPTIONS, signal: controller.signal }));
  await ready; controller.abort();
  await assert.rejects(() => running, { name: 'AbortError' });
  await closed;
  const timeoutAdapter = new GoogleAdapter({ config: { baseURL, streamIdleTimeoutMs: 30 }, resolveApiKey: async () => 'test' });
  await assert.rejects(() => collect(timeoutAdapter.stream(OPTIONS)), { code: 'TIMEOUT' });
});

test('stopping iteration releases the HTTP stream', async t => {
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const baseURL = await server(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify(chunk([{ text: 'started' }]))}\n\n`);
    res.on('close', disconnected);
  });
  const adapter = new GoogleAdapter({ config: { baseURL }, resolveApiKey: async () => 'test' });
  for await (const event of adapter.stream(OPTIONS)) if (event.type === 'text-delta') break;
  await closed;
});
