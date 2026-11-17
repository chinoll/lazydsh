// SPDX-License-Identifier: GPL-3.0-only
import { LlmAdapter, LlmError, assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { resolveConfig, modelId, invalid } from './config.js';
import { imageTarget, toContents } from './content.js';
import { events, request, requestScope, responseJSON } from './transport.js';
import { toChunks } from './stream.js';
import { NATIVE_WEB_REPLACEMENTS } from './search-tools.js';

const effortNames = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };

export class GoogleAdapter extends LlmAdapter {
  constructor({ config = () => ({}), resolveApiKey, fetchImpl = globalThis.fetch, resolveAttachments, resolveImageAccess } = {}) {
    super();
    this.config = typeof config === 'function' ? config : () => config;
    this.resolveApiKey = resolveApiKey ?? (async current => {
      const key = process.env[current.apiKeyEnv];
      if (!key) throw new LlmError(`Set ${current.apiKeyEnv} to use Google Gemini.`, 'MISSING_CREDENTIAL');
      return key;
    });
    this.fetchImpl = fetchImpl;
    this.resolveAttachments = resolveAttachments;
    this.resolveImageAccess = resolveImageAccess;
  }

  current() { return resolveConfig(this.config()); }
  providerInfo(provider) { return { id: provider, name: this.current().displayName }; }
  providerRetryPolicy() { return this.current().retryPolicy; }
  imageRequestTarget(provider, model, image) { this.modelOf(this.current(), provider, model); return imageTarget(image); }

  modelOf(config, provider, id) {
    if (provider !== config.provider) invalid(`adapter does not own provider "${provider}".`, 'NO_ADAPTER');
    const model = config.models.find(entry => entry.id === id);
    if (!model) invalid(`model "${id}" is not configured.`, 'UNKNOWN_MODEL');
    return model;
  }

  info(config, provider, id) {
    const model = this.modelOf(config, provider, id);
    const maxTokens = model.maxTokens ?? config.maxTokens;
    return {
      provider, id, name: model.name, inputModalities: ['text', 'image'],
      ...(model.contextWindow ? { context: { contextWindow: model.contextWindow } } : {}),
      ...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
      reasoning: {
        efforts: model.thinkingLevels.map(id => ({ id, name: effortNames[id] })),
        ...(model.reasoning === undefined ? {} : { defaultEffort: model.reasoning }),
      },
    };
  }

  async key(config) { return assertUsableApiKey(await this.resolveApiKey(config), 'lazydsh/gemini', config.apiKeyEnv); }

  async listModels(provider) {
    const config = this.current();
    if (provider !== config.provider) invalid('unknown provider.', 'NO_ADAPTER');
    try { await this.key(config); }
    catch (error) { if (error.code === 'MISSING_CREDENTIAL') return []; throw error; }
    return config.models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: ['text', 'image'] }));
  }

  async resolveModel(provider, model) { return this.info(this.current(), provider, model); }
  async prepareCall(provider, model) {
    const config = this.current();
    return { model: this.info(config, provider, model), stream: options => this.streamWithConfig(options, config) };
  }
  stream(options) { return this.streamWithConfig(options, this.current()); }

  async *streamWithConfig(options, config) {
    const model = this.modelOf(config, options.provider, options.model);
    const reasoning = options.reasoningEffort ?? model.reasoning;
    if (reasoning !== undefined && !model.thinkingLevels.includes(reasoning)) {
      invalid(`model "${model.id}" does not support thinking level "${reasoning}".`, 'UNSUPPORTED_REASONING_EFFORT');
    }
    options.signal?.throwIfAborted();
    const apiKey = await this.key(config);
    const scope = requestScope(options.signal, config.streamIdleTimeoutMs);
    try {
      const history = await toContents({ ...options, signal: scope.signal }, {
        attachments: this.resolveAttachments?.(), imageAccess: this.resolveImageAccess,
      });
      const googleSearch = model.googleSearch ?? config.googleSearch;
      const declarations = (options.tools ?? []).filter(tool => !tool.deferLoading
        && !(googleSearch && NATIVE_WEB_REPLACEMENTS.has(tool.name))).map(tool => ({
        name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters,
      }));
      const tools = [
        ...(googleSearch ? [{ googleSearch: {} }, { urlContext: {} }] : []),
        ...(declarations.length ? [{ functionDeclarations: declarations }] : []),
      ];
      const maxTokens = options.maxTokens ?? model.maxTokens ?? config.maxTokens;
      if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) invalid('maxTokens must be positive.', 'INVALID_REQUEST');
      if (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) invalid('temperature must be between 0 and 2.', 'INVALID_REQUEST');
      if (options.stop !== undefined && (!Array.isArray(options.stop) || options.stop.length > 5 || options.stop.some(value => typeof value !== 'string' || !value))) invalid('stop requires at most five nonempty strings.', 'INVALID_REQUEST');
      const body = {
        ...history,
        generationConfig: {
          thinkingConfig: { includeThoughts: config.includeThoughts, ...(reasoning === undefined ? {} : { thinkingLevel: reasoning.toUpperCase() }) },
          ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.stop?.length ? { stopSequences: options.stop } : {}),
        },
        ...(tools.length ? { tools } : {}),
        ...(googleSearch ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
      };
      const response = await request(this.fetchImpl, `${config.baseURL}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`, {
        apiKey, body, signal: scope.signal,
      });
      yield* toChunks(events(response, scope), { model: model.id, apiKey });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (scope.signal.aborted) throw scope.signal.reason;
      if (error instanceof LlmError) throw error;
      throw new LlmError('Google Gemini stream transport failed.', 'TRANSPORT');
    } finally { scope.close(); }
  }

  async discoverModels(overrides = {}, signal) {
    const config = this.current();
    if (overrides.provider !== undefined && overrides.provider !== config.provider) invalid('unknown discovery provider.', 'NO_ADAPTER');
    // Validate an edited endpoint without mutating the live route.
    const endpoint = overrides.baseURL === undefined ? config.baseURL : resolveConfig({ baseURL: overrides.baseURL }).baseURL;
    const apiKey = overrides.apiKey === undefined ? await this.key(config) : assertUsableApiKey(overrides.apiKey, 'lazydsh/gemini', 'discovery apiKey');
    const scope = requestScope(signal, config.streamIdleTimeoutMs);
    const result = new Map();
    const pages = new Set();
    let pageToken;
    try {
      do {
        const url = new URL(`${endpoint}/models`);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await request(this.fetchImpl, url.href, { apiKey, signal: scope.signal });
        const payload = await responseJSON(response);
        scope.touch();
        if (!Array.isArray(payload.models)) throw new LlmError('Google Gemini model listing is invalid.', 'INVALID_RESPONSE');
        for (const entry of payload.models) {
          if (!entry.supportedGenerationMethods?.includes('generateContent')) continue;
          let id;
          try { id = modelId(entry.name); } catch { continue; }
          result.set(id, {
            id, name: entry.displayName || id, inputModalities: ['text', 'image'],
            ...(Number.isSafeInteger(entry.inputTokenLimit) && entry.inputTokenLimit > 0 ? { contextWindow: entry.inputTokenLimit } : {}),
            ...(Number.isSafeInteger(entry.outputTokenLimit) && entry.outputTokenLimit > 0 ? { maxTokens: entry.outputTokenLimit } : {}),
          });
        }
        pageToken = payload.nextPageToken;
        if (pageToken && (typeof pageToken !== 'string' || pages.has(pageToken) || pages.size >= 100)) throw new LlmError('Google Gemini model pagination did not terminate.', 'INVALID_RESPONSE');
        pages.add(pageToken);
      } while (pageToken);
      return [...result.values()];
    } finally { scope.close(); }
  }
}
