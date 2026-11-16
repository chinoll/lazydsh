// SPDX-License-Identifier: GPL-3.0-only
import { collectSources } from './sources.js';
export const sourcesKey = 'lazydsh.sources';
const match = event => Number.isInteger(event.data?.turn)
  ? { id: String(event.data.turn), role: 'start' } : null;
export const sourcesDefinition = {
  kind: sourcesKey,
  match: Object.fromEntries(['turn/start', 'turn/end', 'tool/call', 'tool/result',
    'assistant/message', 'plugin:lazydsh/request'].map(type => [type, match])),
  start: (_, entry) => ({ turn: entry.event.data.turn }),
  update: context => context.state,
  buildLocationData: (context, scope) => {
    if (scope !== 'turn' || !context.state) return null;
    return { kind: 'turn', turn: context.state.turn, key: sourcesKey,
      value: collectSources(context.matches.map(m => m.event), context.state.turn) };
  },
};
