// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, symbols } from '@deepseek-ai/cordis';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolsService } from '@deepseek-ai/dsh-tools';
import * as Native from '@deepseek-ai/dsh-tool-executor-native';
import { resolveConfig } from '../src/gemini/config.js';
import { installSearchToolFilter } from '../src/gemini/search-tools.js';
import { GoogleAdapter } from '../src/gemini/adapter.js';

const MODEL = 'gemini-4-argon';
const selection = { provider: 'google-native', model: MODEL };

test('step admission removes DSH search and fetch declarations and guidance, preserves other routes and disposal', async t => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolsService);
  await ctx.plugin(Native);
  let ready = true;
  for (const name of ['web_search', 'web_fetch', 'calculate']) {
    ctx.tools.register({
      name, description: name, parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: value }] },
      execute: async () => 'ok',
    }, { when: () => ready || name !== 'web_search' });
  }
  for (const name of ['web_search', 'web_fetch']) ctx.systemPrompt.section({
    name: `tool:${name}`, order: 10,
    text: ({ scope, toolSet }) => ctx.tools.get(name, scope, toolSet) ? `DSH ${name} guidance` : '',
  });
  let config = resolveConfig({ models: [{ id: MODEL }] });
  const original = ctx.tools[symbols.original].resolve;
  const plugin = await ctx.plugin({ apply: ctx => installSearchToolFilter(ctx, () => config) });
  const agent = {};
  const resolve = (modelSelection = selection, owner = agent) => ctx.tools.resolve({
    agent: owner, modelSelection, signal: new AbortController().signal,
  });
  const native = await resolve();
  assert.equal(native.view(agent).has('web_search'), false);
  assert.equal(native.view(agent).has('web_fetch'), false);
  assert.equal(native.view(agent).has('calculate'), true);
  assert.equal(native.view({}).size, 0);
  const assembly = await ctx.systemPrompt.assemble({ scope: agent, toolSet: native, modelSelection: selection });
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['calculate']);
  assert.equal(assembly.sections.some(section => section.text.includes('DSH web_')), false);
  for (const name of ['web_search', 'web_fetch']) assert.equal(ctx.tools.executable(name, agent, native), undefined);
  const otherAgent = {};
  const other = await resolve({ provider: 'deepseek', model: 'deepseek-chat' }, otherAgent);
  assert.equal(other.view(otherAgent).has('web_search'), true);
  assert.equal(other.view(otherAgent).has('web_fetch'), true);
  config = resolveConfig({ googleSearch: false, models: [{ id: MODEL }] });
  const disabled = await resolve();
  assert.equal(disabled.view(agent).has('web_search'), true);
  assert.equal(disabled.view(agent).has('web_fetch'), true);
  assert.equal(native.view(agent).has('web_search'), false, 'an admitted step retains its search policy');
  config = resolveConfig({ googleSearch: true, models: [{ id: MODEL, googleSearch: false }] });
  assert.equal((await resolve()).view(agent).has('web_search'), true);
  config = resolveConfig({ googleSearch: false, models: [{ id: MODEL, googleSearch: true }] });
  assert.equal((await resolve()).view(agent).has('web_search'), false);
  ready = false;
  assert.equal((await resolve({ provider: 'deepseek', model: 'deepseek-chat' })).view(agent).has('web_search'), false);
  native.dispose();
  assert.equal(native.view(agent).size, 0);
  ready = true;
  await plugin.dispose();
  assert.equal(ctx.tools[symbols.original].resolve, original);
  assert.equal((await resolve()).view(agent).has('web_search'), true);
});

test('direct adapter calls omit DSH search and fetch when native search is enabled', async () => {
  for (const googleSearch of [true, false]) {
    let sent;
    const adapter = new GoogleAdapter({
      config: { googleSearch, models: [{ id: MODEL }] },
      resolveApiKey: async () => 'test',
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(init.body);
        return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const tools = ['web_search', 'web_fetch', 'calculate'].map(name => ({
      name, description: name, parameters: { type: 'object', properties: {} },
    }));
    for await (const _ of adapter.stream({ ...selection, messages: [{ role: 'user', content: [{ type: 'text', text: 'Search' }] }], tools })) {}
    const names = sent.tools.flatMap(tool => tool.functionDeclarations ?? []).map(tool => tool.name);
    assert.deepEqual(names, googleSearch ? ['calculate'] : ['web_search', 'web_fetch', 'calculate']);
    assert.equal(sent.tools.some(tool => tool.googleSearch), googleSearch);
    assert.equal(sent.tools.some(tool => tool.urlContext), googleSearch);
    assert.equal(tools.length, 3);
  }
});
