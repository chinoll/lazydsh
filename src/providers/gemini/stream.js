// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { fingerprint } from './content.js';
import { apiError } from './transport.js';

export function tokenUsage(usage) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const prompt = count(usage.promptTokenCount);
  const cache = Math.min(prompt, count(usage.cachedContentTokenCount));
  const reasoning = count(usage.thoughtsTokenCount);
  return {
    inputTokens: prompt - cache, cacheReadTokens: cache,
    outputTokens: count(usage.candidatesTokenCount) + reasoning,
    reasoningTokens: reasoning,
    ...(Number.isSafeInteger(usage.totalTokenCount) && usage.totalTokenCount >= 0 ? { totalTokens: usage.totalTokenCount } : {}),
  };
}

export async function* toChunks(source, { model, apiKey }) {
  const records = [];
  let active;
  let pending = [];
  let finishReason;
  let usage;
  let grounding;
  let urlContext;
  let responseId;
  let modelVersion;
  const ids = new Set();
  const close = function* () {
    if (active) { yield { type: 'block-end', index: active.index, block: { ...active.block } }; active = undefined; }
  };
  const start = function* (block) {
    active = { index: records.length, block, parts: pending }; pending = [];
    records.push(active);
    yield { type: 'block-start', index: active.index, blockType: block.type };
  };

  for await (const event of source) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new LlmError('Invalid Google Gemini stream event.', 'INVALID_RESPONSE');
    if (event.error) throw apiError(event.error, event.error.code, apiKey);
    if (event.promptFeedback?.blockReason) throw new LlmError(`Google Gemini blocked the prompt (${event.promptFeedback.blockReason}).`, 'CONTENT_FILTER');
    responseId ??= event.responseId;
    modelVersion ??= event.modelVersion;
    if (event.usageMetadata) usage = { ...usage, ...event.usageMetadata };
    const candidate = event.candidates?.find(item => (item.index ?? 0) === 0);
    if (!candidate) continue;
    if (candidate.finishReason) finishReason = candidate.finishReason;
    if (candidate.groundingMetadata) grounding = { ...grounding, ...structuredClone(candidate.groundingMetadata) };
    if (candidate.urlContextMetadata) urlContext = { ...urlContext, ...structuredClone(candidate.urlContextMetadata) };
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === 'string') {
        const type = part.thought ? 'reasoning' : 'text';
        if (active?.block.type !== type) { yield* close(); yield* start({ type, text: '' }); }
        active.block.text += part.text;
        // Retain exact native fragments and all signatures. Visible deltas may coalesce,
        // but signed native parts must never be merged, rewritten, or reordered.
        active.parts.push(structuredClone(part));
        if (part.text) yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: active.index, text: part.text };
      } else if (part.functionCall) {
        yield* close();
        const call = part.functionCall;
        if (!call.name || !call.args || typeof call.args !== 'object' || Array.isArray(call.args) || call.partialArgs) {
          if (call.args === undefined && call.name && !call.partialArgs) { /* zero-argument functions */ }
          else throw new LlmError('Google Gemini returned an invalid or partial function call.', 'INVALID_RESPONSE');
        }
        const id = call.id || `google-${randomUUID()}`;
        if (ids.has(id)) throw new LlmError('Google Gemini returned duplicate function call IDs.', 'INVALID_RESPONSE');
        ids.add(id);
        yield* start({ type: 'tool-call', id, name: call.name, arguments: JSON.stringify(call.args ?? {}) });
        active.parts.push(structuredClone(part));
        yield { type: 'tool-call-delta', index: active.index, id, name: call.name, argumentsDelta: active.block.arguments };
        yield* close();
      } else if (part.toolCall || part.toolResponse || part.thoughtSignature) {
        // Built-in search and URL retrieval run on Google's servers.
        yield* close(); pending.push(structuredClone(part));
      } else throw new LlmError('Google Gemini returned unsupported non-text output.', 'UNSUPPORTED_CONTENT');
    }
  }
  yield* close();
  if (usage) yield { type: 'usage', usage: tokenUsage(usage) };
  if (!finishReason) throw new LlmError('Google Gemini stream ended before its finish reason.', 'TRANSPORT');
  if (!['STOP', 'MAX_TOKENS'].includes(finishReason)) {
    const code = /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII|IMAGE_SAFETY/.test(finishReason) ? 'CONTENT_FILTER' : 'INVALID_RESPONSE';
    throw new LlmError(`Google Gemini generation ended with ${finishReason}.`, code);
  }
  const visible = records.some(record => record.block.type === 'tool-call' || record.block.type === 'text' && record.block.text.trim());
  if (!visible && finishReason === 'STOP') throw new LlmError('Google Gemini returned no answer or function call.', 'EMPTY_RESPONSE');
  if (pending.length && records.length) records.at(-1).parts.push(...pending);
  // lazydsh renders sources from metadata in its collapsible UI footer.
  // Keep answer text and signed native fragments exactly as Google returned them.
  yield {
    type: 'finish', reason: { kind: finishReason === 'MAX_TOKENS' ? 'max-tokens' : ids.size ? 'tool-calls' : 'stop' },
    replayState: {
      response: {
        kind: 'google-native', version: 1, model, finishReason,
        ...(responseId ? { responseId } : {}), ...(modelVersion ? { modelVersion } : {}),
        ...(grounding ? { groundingMetadata: grounding } : {}),
        ...(urlContext ? { urlContextMetadata: urlContext } : {}),
      },
      blocks: records.map(record => ({ fingerprint: fingerprint(record.block), parts: record.parts })),
    },
  };
}
