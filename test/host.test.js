// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { apply, Config } from '../src/index.js';

test('host middleware persists receipts outside the real DSH message surface', async () => {
  const session = Session.create(SessionId('00000000-0000-4000-8000-000000000001'));
  const callbacks = new Map();
  apply({ on: (name, cb) => callbacks.set(name, cb),
    get: name => name === 'agents' ? { get: () => ({ session }) } : undefined,
    logger: { warn: (...args) => { throw new Error(String(args)); } },
  });
  const observe = callbacks.get('session/event');
  observe(session, { type: 'step/start', data: { turn: 1, step: 2 } });
  const content = [{ type: 'text', text: 'Fetched https://example.com/ (HTTP 200)\nBody' }];
  const message = { role: 'tool', toolCallId: 'fetch', content };
  observe(session, { type: 'tool/result', data: { turn: 1, step: 1, message } });
  const original = session.deriveMessages();
  const options = Object.freeze({ sessionId: session.id, messages: Object.freeze([Object.freeze(message)]) });
  const chunks = [{ type: 'text-delta', text: 'answer' }, { type: 'finish', reason: { kind: 'stop' } }];
  const received = [];
  for await (const chunk of callbacks.get('llm/stream')(options, async function* () { yield* chunks; })) received.push(chunk);
  assert.deepEqual(received, chunks);
  assert.deepEqual(session.deriveMessages(), original);
  const records = session.snapshotEvents().filter(e => e.type === 'plugin:lazydsh/request');
  assert.equal(records.length, 1);
  assert.equal(records[0].ignorable, true);
  assert.deepEqual(records[0].data.results, [{ callId: 'fetch', unchanged: true }]);
  const restored = Session.create(session.id, session.snapshotEvents());
  assert.deepEqual(restored.deriveMessages(), original);
  assert.deepEqual(restored.snapshotEvents().filter(e => e.type === 'plugin:lazydsh/request'), records);
});

test('settings has one independently configurable switch, enabled by default', () => {
  const config = Config({});
  assert.equal(config.get().showRelatedLinks, true);
  assert.equal(Config({ showRelatedLinks: false }).get().showRelatedLinks, false);
});
