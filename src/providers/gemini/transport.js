// SPDX-License-Identifier: GPL-3.0-only
import { LlmError, attributionHeaders, isContextWindowExceededError } from '@deepseek-ai/dsh-llm';

export function requestScope(parent, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new LlmError('Google Gemini stream timed out.', 'TIMEOUT')), timeoutMs);
    timer.unref?.();
  };
  touch();
  return { signal, touch, close() { clearTimeout(timer); controller.abort(); } };
}

async function readLimited(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new LlmError('Google Gemini response exceeded its size limit.', 'INVALID_RESPONSE');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function apiError(error, status, apiKey, headers) {
  const detail = String(error?.message ?? 'Request failed');
  let code = status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : 'INVALID_REQUEST';
  if (isContextWindowExceededError(detail) || /input token count.*exceeds.*maximum/i.test(detail)) code = 'CONTEXT_WINDOW_EXCEEDED';
  const retryInfo = error?.details?.find(item => item['@type']?.endsWith('/google.rpc.RetryInfo'));
  const quotaInfo = error?.details?.find(item => item['@type']?.endsWith('/google.rpc.QuotaFailure'));
  if (status === 429 && quotaInfo?.violations?.some(item => /per.?day|daily|billing|balance/i.test(item.quotaId ?? item.description ?? ''))) code = 'QUOTA';
  let delay;
  const retryAfter = headers?.get('retry-after');
  if (retryAfter) delay = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
  if (delay === undefined && /^\d+(?:\.\d+)?s$/.test(retryInfo?.retryDelay ?? '')) delay = parseFloat(retryInfo.retryDelay) * 1000;
  let message = detail;
  for (const secret of [apiKey, apiKey && encodeURIComponent(apiKey)]) if (secret) message = message.replaceAll(secret, '[redacted]');
  message = message.replace(/AIza[\w-]+/g, '[redacted]').slice(0, 1200);
  return new LlmError(`Google Gemini: ${message}`, code, {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    ...(Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}),
  });
}

export async function request(fetchImpl, url, { apiKey, signal, body }) {
  signal?.throwIfAborted();
  let response;
  try {
    response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST', signal, redirect: 'error',
      headers: { ...attributionHeaders(), 'x-goog-api-key': apiKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new LlmError('Google Gemini network request failed.', 'TRANSPORT');
  }
  if (!response.ok) {
    let parsed;
    try { parsed = JSON.parse(await readLimited(response, 65536)); } catch { signal?.throwIfAborted(); }
    throw apiError(parsed?.error ?? { message: `HTTP ${response.status}` }, response.status, apiKey, response.headers);
  }
  return response;
}

export async function responseJSON(response) {
  try { return JSON.parse(await readLimited(response, 4 * 1024 * 1024)); }
  catch (error) {
    if (error instanceof LlmError || error?.name === 'AbortError') throw error;
    throw new LlmError('Google Gemini returned invalid JSON.', 'INVALID_RESPONSE');
  }
}

// SSE frames may cross UTF-8 byte boundaries, use CRLF, or carry multiple data lines.
export async function* events(response, scope) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new LlmError('Google Gemini did not return an SSE stream.', 'INVALID_RESPONSE');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  let eventBytes = 0;
  const parse = () => {
    const raw = data.join('\n'); data = []; eventBytes = 0;
    if (!raw || raw === '[DONE]') return undefined;
    try { return JSON.parse(raw); }
    catch { throw new LlmError('Google Gemini returned a malformed SSE event.', 'INVALID_RESPONSE'); }
  };
  try {
    while (true) {
      scope.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (!done) scope.touch();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          const event = parse();
          if (event !== undefined) yield event;
        } else if (line.startsWith('data:')) {
          const payload = line.slice(5).replace(/^ /, '');
          data.push(payload); eventBytes += payload.length;
          if (eventBytes > 16 * 1024 * 1024) throw new LlmError('Google Gemini SSE event is too large.', 'INVALID_RESPONSE');
        }
      }
      if (buffer.length > 16 * 1024 * 1024) throw new LlmError('Google Gemini SSE line is too large.', 'INVALID_RESPONSE');
      if (done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
        else if (buffer.trim() && !buffer.startsWith(':')) throw new LlmError('Google Gemini stream ended inside an SSE frame.', 'INVALID_RESPONSE');
        const event = parse();
        if (event !== undefined) yield event;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
