// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { sourcesDefinition, sourcesKey } from '../src/definition.js';

test('official DSH conversation assembler publishes sources on replay and live updates', async () => {
  const bundle = await build({
    stdin: { contents: 'export { ConversationNodeAssembler } from "@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembler.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'node',
  });
  const { ConversationNodeAssembler } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
  const definition = { ...sourcesDefinition, match: event => sourcesDefinition.match[event.type]?.(event) ?? null };
  const views = { entries: () => [{ target: 'test', create: () => ({ replace: input => input.timeline, apply: input => input.timeline }) }] };
  const assembler = new ConversationNodeAssembler({ entries: () => [definition], fallbackEntry: () => undefined }, views);
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [], source: { replayState: { response: { kind: 'google-native', urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://example.com/', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } } } } } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } },
  ].map((event, seq) => ({ type: 'event', event: { ...event, seq, time: seq } }));
  assembler.activateTarget('test');
  assembler.replaceWindow(events, false);
  assembler.flush();
  const turn = assembler.snapshot('test').turns.get(1);
  assert.equal(turn.data.get(sourcesKey)[0].state, 'read');
  const source = turn.data.source(sourcesKey);
  let updates = 0;
  source.subscribe(() => updates++);
  assembler.replaceWindow(events.slice(0, 2), false);
  assembler.flush();
  assert.deepEqual(assembler.snapshot('test').turns.get(1).data.get(sourcesKey), []);
  for (const entry of events.slice(2)) { assembler.append(entry); assembler.flush(); }
  assert.equal(assembler.snapshot('test').turns.get(1).data.get(sourcesKey)[0].state, 'read');
  assert.ok(updates > 0);
});
