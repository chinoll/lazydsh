// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
const fingerprint = content => createHash('sha256').update(JSON.stringify(content ?? [])).digest('hex');
export function createReceiptTracker() {
  const states = new WeakMap();
  return {
    observe(session, event) {
      const { type, data } = event;
      if (type === 'turn/start' || (type === 'step/start' && states.get(session)?.turn !== data.turn)) {
        states.set(session, { turn: data.turn, step: data.step, results: new Map() });
      }
      const state = states.get(session);
      if (!state || data.turn !== state.turn) return;
      if (type === 'step/start') state.step = data.step;
      if (type === 'tool/result') {
        const message = data.message;
        state.results.set(message.toolCallId, fingerprint(message.content));
      }
      if (type === 'turn/end') states.delete(session);
    },
    receipt(session, messages) {
      const state = states.get(session);
      if (!state || !Number.isInteger(state.step)) return undefined;
      const results = [];
      for (const message of messages ?? []) {
        if (message.role !== 'tool' || !state.results.has(message.toolCallId)) continue;
        results.push({ callId: message.toolCallId,
          unchanged: fingerprint(message.content) === state.results.get(message.toolCallId) });
      }
      return { version: 1, turn: state.turn, step: state.step, results };
    },
  };
}
