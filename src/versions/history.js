// SPDX-License-Identifier: GPL-3.0-only

/** Read the opening human prompt of each turn, excluding injected runtime context. */
export function promptTurns(events) {
  const turns = new Map();
  let current;
  let selection;
  for (const event of events) {
    if (event.type === 'request/header') selection = event.data.header?.config ?? selection;
    if (event.type === 'turn/start') {
      current = { turn: event.data.turn, startSeq: event.seq, selection, answers: [] };
      turns.set(current.turn, current);
    }
    if (!current) continue;
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data.source?.kind === 'user') {
      if (!current.prompt) current.prompt = event.data;
      else current.steered = true;
    }
    if (event.type === 'request/header' && !current.answers.length) current.selection = selection;
    if (event.type === 'assistant/message' && event.data.turn === current.turn) {
      current.answers.push(event.data.message.id);
    }
    if (event.type === 'turn/end') {
      if (event.data.turn === current.turn) current.complete = true;
      current = undefined;
    }
  }
  return [...turns.values()].filter(turn => turn.prompt);
}

export function selectionOf(value) {
  if (!value?.provider || !value?.model) return undefined;
  return { provider: value.provider, model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) };
}
