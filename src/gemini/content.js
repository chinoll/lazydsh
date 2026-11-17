// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from 'node:crypto';
import { LlmError, fileHandleText, offloadedImageText, requestImageHandleText, requiredImageOffload } from '@deepseek-ai/dsh-llm';
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment';

export const fingerprint = block => createHash('sha256').update(JSON.stringify(block)).digest('hex');
export const imageTarget = ref => ({ ...requestImageDimensions(ref.width, ref.height, 4194304), maxBytes: 1048576 });

function replayParts(message, provider, model) {
  if (message.source?.provider !== provider || message.source?.model !== model) return undefined;
  const envelope = message.source.replayState;
  if (envelope === undefined) return undefined;
  if (envelope?.response?.kind !== 'google-native' || envelope.response.version !== 1
      || envelope.response.model !== model || !Array.isArray(envelope.blocks)
      || envelope.blocks.length !== message.content.length) {
    throw new LlmError('Google Gemini history contains invalid replay metadata.', 'INVALID_REPLAY_STATE');
  }
  return envelope.blocks.flatMap((entry, i) => {
    if (entry?.fingerprint !== fingerprint(message.content[i]) || !Array.isArray(entry.parts)) {
      throw new LlmError('Google Gemini history was modified without its signed replay metadata.', 'INVALID_REPLAY_STATE');
    }
    return structuredClone(entry.parts);
  });
}

function argsOf(raw) {
  let args;
  try { args = JSON.parse(raw); } catch { /* Refuse malformed historical tool calls. */ }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new LlmError('Google Gemini requires object tool arguments.', 'INVALID_REQUEST');
  return args;
}

export async function toContents(options, { attachments, imageAccess } = {}) {
  const images = new Map();
  for (const message of options.messages) for (const block of message.content) {
    if (block.type === 'image' && !block.offloaded) {
      if (!['user', 'tool'].includes(message.role)) throw new LlmError('Google Gemini only accepts user/tool image inputs.', 'UNSUPPORTED_CONTENT');
      if (!attachments) throw new LlmError('Google Gemini image input requires the DSH attachments service.', 'UNSUPPORTED_CONTENT');
      if (!images.has(block.attachment.attachmentId)) {
        options.signal?.throwIfAborted();
        images.set(block.attachment.attachmentId, await attachments.readImageRequest(block.attachment, imageTarget(block.attachment), options.signal));
      }
    }
  }
  const offloadImages = requiredImageOffload(options.messages, {
    representation: 'base64', maxBytes: 20 * 1024 * 1024, maxImages: 50, countQuantum: 10,
  }, block => images.get(block.attachment.attachmentId).bytes);
  if (offloadImages > 0) throw new LlmError('Google Gemini image input exceeds the request budget.', 'IMAGE_OFFLOAD_REQUIRED', { offloadImages });

  const inputParts = blocks => blocks.flatMap(block => {
    if (block.type === 'text') return block.text ? [{ text: block.text }] : [];
    if (block.type === 'file') return [{ text: fileHandleText(block.attachment, undefined) }];
    if (block.type === 'image') {
      const access = imageAccess?.(block.attachment);
      if (block.offloaded) return [{ text: offloadedImageText(block.attachment, access) }];
      const image = images.get(block.attachment.attachmentId);
      return [
        { text: requestImageHandleText(block.attachment, image, access) },
        { inlineData: { mimeType: image.mediaType, data: Buffer.from(image.data).toString('base64') } },
      ];
    }
    if (block.type === 'tool-addition' || block.type === 'tool-removal') return [];
    throw new LlmError(`Google Gemini cannot send input block "${block.type}".`, 'UNSUPPORTED_CONTENT');
  });

  const contents = [];
  const calls = new Map();
  let system;
  const append = (role, parts) => {
    if (!parts.length) return;
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const message of options.messages) {
    if (message.role === 'system') {
      if (message.content.some(block => block.type !== 'text')) throw new LlmError('Google Gemini system instructions must be text.', 'UNSUPPORTED_CONTENT');
      system = message.content.map(block => block.text).join('\n');
    } else if (message.role === 'assistant') {
      let parts = replayParts(message, options.provider, options.model);
      if (parts === undefined) {
        // Imported/model-switched history has no reusable Google signatures. Google documents
        // this sentinel for externally supplied function history; never replace native signatures.
        parts = message.content.flatMap(block => {
          if (block.type === 'text') return block.text ? [{ text: block.text }] : [];
          if (block.type === 'reasoning') return [];
          if (block.type === 'tool-call') return [{
            functionCall: { id: block.id, name: block.name, args: argsOf(block.arguments) },
            thoughtSignature: 'skip_thought_signature_validator',
          }];
          throw new LlmError('Google Gemini cannot replay this assistant content.', 'UNSUPPORTED_CONTENT');
        });
      }
      const nativeCalls = parts.filter(part => part.functionCall).map(part => part.functionCall);
      const blocks = message.content.filter(block => block.type === 'tool-call');
      if (nativeCalls.length !== blocks.length) throw new LlmError('Google Gemini replay tool calls are misaligned.', 'INVALID_REPLAY_STATE');
      blocks.forEach((block, i) => calls.set(block.id, nativeCalls[i]));
      append('model', parts);
    } else if (message.role === 'tool') {
      const call = calls.get(message.toolCallId);
      if (!call) throw new LlmError('Google Gemini tool result has no matching function call.', 'INVALID_REQUEST');
      const parts = inputParts(message.content);
      const text = parts.filter(part => part.text !== undefined).map(part => part.text).join('\n');
      const media = parts.filter(part => part.inlineData);
      append('user', [{ functionResponse: {
        name: call.name, ...(call.id ? { id: call.id } : {}),
        response: message.isError ? { error: text } : { output: text },
        ...(media.length ? { parts: media } : {}),
      } }]);
    } else if (message.role === 'user' || message.role === 'developer') {
      append('user', inputParts(message.content));
    } else throw new LlmError('Google Gemini received an unsupported message role.', 'UNSUPPORTED_CONTENT');
  }
  if (!contents.length) throw new LlmError('Google Gemini requires nonempty conversation input.', 'INVALID_REQUEST');
  const instruction = [options.system, system].filter(Boolean).join('\n\n');
  return { contents, ...(instruction ? { systemInstruction: { parts: [{ text: instruction }] } } : {}) };
}
