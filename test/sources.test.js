// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSources, safeUrl } from '../src/sources.js';
import { createReceiptTracker } from '../src/receipts.js';

const url = 'https://example.com/article';
const event = (type, seq, data = {}) => ({ type, seq, data: { turn: 1, step: 1, ...data } });
const call = (name = 'web_fetch', id = 'fetch') => event('tool/call', 1, { name, callId: id, arguments: JSON.stringify({ url }) });
const message = (text, id = 'fetch') => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text }] });
const result = (overrides = {}) => event('tool/result', 2, {
  message: message(`Fetched ${url} (HTTP 200)\n\nPage body`),
  meta: { url, statusCode: 200, truncated: false }, ...overrides,
});
const receipt = (results = [{ callId: 'fetch', unchanged: true }]) => event('plugin:lazydsh/request', 3, { version: 1, step: 2, results });
const answer = (replay) => event('assistant/message', 4, { step: 2, message: { content: [], source: { replayState: replay } } });
const native = response => answer({ response: { kind: 'google-native', ...response }, blocks: [] });

test('successful fetch is read only after an unchanged result reaches an answered request', () => {
  const events = [call(), result(), receipt()];
  assert.equal(collectSources(events, 1)[0].state, 'unknown');
  assert.equal(collectSources([...events, answer()], 1)[0].state, 'read');
  assert.equal(collectSources([call(), result(), answer()], 1)[0].state, 'unknown');
});
test('offloaded, absent and failed results never masquerade as read pages', () => {
  assert.equal(collectSources([call(), result(), receipt([{ callId: 'fetch', unchanged: false }]), answer()], 1)[0].state, 'unknown');
  assert.equal(collectSources([call(), result(), receipt([]), answer()], 1)[0].detail, 'not-admitted');
  const failed = result({ message: { ...message('Forbidden'), isError: true } });
  assert.equal(collectSources([call(), failed, receipt(), answer()], 1)[0].detail, 'failed');
  const noBody = result({ message: message('Result stored in a file. Read it to see content.') });
  assert.equal(collectSources([call(), noBody, receipt(), answer()], 1)[0].state, 'unknown');
});
test('search snippets and fetches merge without claiming all search hits were read', () => {
  const searchResult = event('tool/result', 0, { message: message(`Sources:\n- [An article](${url}) — excerpt`, 'search'),
    meta: { sources: [{ url, title: 'An article' }, { url: 'https://example.net/hidden', title: 'Not in output' }] } });
  const events = [searchResult, receipt([{ callId: 'search', unchanged: true }]), answer()];
  assert.equal(collectSources(events, 1)[0].detail, 'snippet');
  assert.equal(collectSources(events, 1)[1].state, 'unknown');
  events.splice(1, 0, call(), result());
  events[3] = receipt([{ callId: 'search', unchanged: true }, { callId: 'fetch', unchanged: true }]);
  const rows = collectSources(events, 1);
  assert.equal(rows[0].state, 'read');
  assert.equal(rows[0].title, 'An article');
});
test('truncation, HTTP errors, missing results, redirects and unsafe URLs', () => {
  const partial = result({ meta: { url, statusCode: 200, truncated: true } });
  assert.equal(collectSources([call(), partial, receipt(), answer()], 1)[0].detail, 'partial');
  assert.equal(collectSources([call()], 1)[0].detail, 'pending');
  const forbidden = result({ meta: { url, statusCode: 403 } });
  assert.equal(collectSources([call(), forbidden, receipt(), answer()], 1)[0].state, 'unread');
  const redirect = result({ meta: { url: 'https://example.net/final', statusCode: 200 } });
  assert.equal(collectSources([call(), redirect, receipt(), answer()], 1).length, 2);
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://user:pass@example.com', 'bad']) assert.equal(safeUrl(value), undefined);
  assert.equal(safeUrl(url + '#part'), url);
});
test('native Google evidence distinguishes used sources, failed URL context and undisclosed usage', () => {
  const rows = collectSources([native({
    groundingMetadata: { groundingChunks: [{ web: { uri: url, title: 'Used' } }, { web: { uri: 'https://example.net/unused' } }], groundingSupports: [{ groundingChunkIndices: [0] }] },
    urlContextMetadata: { urlMetadata: [
      { retrievedUrl: 'https://example.org/read', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' },
      { retrievedUrl: 'https://example.org/failed', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_ERROR' },
    ] },
  })], 1);
  assert.deepEqual(rows.map(r => r.state), ['read', 'unknown', 'read', 'unread']);
});
test('native URL context tool responses, pending URLs, and suggestion HTML', () => {
  const rows = collectSources([answer({ response: { kind: 'google-native' }, blocks: [{ parts: [
    { toolCall: { id: 'a', toolType: 'URL_CONTEXT', args: { urls: [url, 'https://example.net/pending'] } } },
    { toolResponse: { id: 'a', toolType: 'URL_CONTEXT', response: { url_metadata: [{ retrieved_url: url, url_retrieval_status: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } } },
    { toolResponse: { toolType: 'GOOGLE_SEARCH_WEB', response: { search_suggestions: '<a href="https://google.com/search?q=test">search</a>' } } },
  ] }] })], 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].state, 'read');
  assert.equal(rows[1].state, 'unknown');
});
test('turn isolation, deduplication, and later failures preserve successful reading', () => {
  const events = [call(), result(), receipt(), answer(), event('tool/result', 5, { message: { ...message('failed'), isError: true }, meta: { url } })];
  assert.equal(collectSources(events, 1).length, 1);
  assert.equal(collectSources(events, 1)[0].state, 'read');
  assert.deepEqual(collectSources(events, 2), []);
  assert.deepEqual(collectSources([event('assistant/message', 1, { message: { content: [{ type: 'text', text: url }] } })], 1), []);
});
test('receipt tracker compares exact model-facing content and isolates sessions and turns', () => {
  const tracker = createReceiptTracker(), a = {}, b = {};
  tracker.observe(a, event('step/start', 0));
  tracker.observe(a, result());
  assert.deepEqual(tracker.receipt(a, [result().data.message]).results, [{ callId: 'fetch', unchanged: true }]);
  assert.deepEqual(tracker.receipt(a, [message('offloaded')]).results, [{ callId: 'fetch', unchanged: false }]);
  assert.equal(tracker.receipt(b, []), undefined);
  tracker.observe(a, event('turn/end', 9));
  assert.equal(tracker.receipt(a, []), undefined);
  tracker.observe(a, event('step/start', 10, { turn: 2 }));
  assert.deepEqual(tracker.receipt(a, [result().data.message]).results, []);
});
