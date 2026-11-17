// SPDX-License-Identifier: GPL-3.0-only
import z from '@deepseek-ai/schemastery';
import { LlmError, RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';

export const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
import { LEVELS, knownLevels } from './thinking-levels.js';
export { LEVELS, knownLevels };
export const DEFAULT_MODELS = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', contextWindow: 1048576 },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', contextWindow: 1048576 },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', contextWindow: 1048576 },
];

const level = () => z.union(LEVELS);
const modelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  thinkingLevels: z.array(level()).default(undefined).description('该模型支持的 thinkingLevel；未知新模型可在这里显式声明。'),
  reasoning: level().description('该模型的默认思考强度。'),
  googleSearch: z.boolean().description('覆盖提供方的 Google 搜索与网页读取开关。'),
});

export const Config = z.object({
  provider: z.string().default('google-native'),
  displayName: z.string().default('Google Gemini (Native)'),
  apiKeyEnv: z.string().role('credential-ref').default('GEMINI_API_KEY').volatile(),
  baseURL: z.string().default(BASE_URL).volatile(),
  models: z.array(modelSchema).default(DEFAULT_MODELS).volatile(),
  reasoning: level().description('默认思考强度；留空沿用模型默认值。会话选择优先。').volatile(),
  googleSearch: z.boolean().default(true).description('允许 Gemini 使用 Google 内置搜索与 URL Context 读取网页，替代 DSH 搜索和网页读取工具。').volatile(),
  includeThoughts: z.boolean().default(true).description('显示模型返回的思考摘要。').volatile(),
  maxTokens: z.number().step(1).min(1).volatile(),
  streamIdleTimeoutMs: z.number().step(1).min(1).default(120000).volatile(),
  retryPolicy: RetryPolicySchema,
});

export function plainConfig(config) {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [
    key, value && typeof value.get === 'function' ? value.get() : value,
  ]));
}

export function invalid(message, code = 'INVALID_CONFIG') {
  throw new LlmError(`Google Gemini: ${message}`, code);
}

export function modelId(value) {
  const id = typeof value === 'string' ? value.replace(/^models\//, '') : '';
  const match = /^gemini-(\d+)(?:[.-][a-z0-9.-]+)?$/.exec(id);
  if (!match || Number(match[1]) < 3) invalid('only Gemini 3 and later model IDs are supported.');
  if (/(?:^|-)(?:image|tts|audio|live|embedding)(?:-|$)/.test(id)) {
    invalid(`model "${id}" is not a supported text/tool model.`);
  }
  return id;
}


function positive(value, name) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) invalid(`${name} must be a positive integer.`);
}

export function resolveConfig(raw = {}) {
  const config = {
    provider: 'google-native', displayName: 'Google Gemini (Native)', apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: BASE_URL, models: DEFAULT_MODELS, googleSearch: true, includeThoughts: true,
    streamIdleTimeoutMs: 120000, ...structuredClone(raw),
  };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.provider)) invalid('invalid provider route.');
  if (typeof config.apiKeyEnv !== 'string' || !config.apiKeyEnv.trim()) invalid('apiKeyEnv must name a credential reference.');
  let url;
  try { url = new URL(config.baseURL); } catch { invalid('baseURL must be an absolute Gemini API URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    invalid('baseURL must be an HTTP(S) API root without credentials, query, or fragment.');
  }
  config.baseURL = url.href.replace(/\/+$/, '');
  for (const key of ['googleSearch', 'includeThoughts']) if (typeof config[key] !== 'boolean') invalid(`${key} must be boolean.`);
  positive(config.maxTokens, 'maxTokens');
  positive(config.streamIdleTimeoutMs, 'streamIdleTimeoutMs');
  if (config.streamIdleTimeoutMs > 2147483647) invalid('streamIdleTimeoutMs is too large.');
  if (config.reasoning !== undefined && !LEVELS.includes(config.reasoning)) invalid('unknown default reasoning level.');
  if (!Array.isArray(config.models)) invalid('models must be an array.');
  const seen = new Set();
  config.models = config.models.map(entry => {
    const id = modelId(entry.id);
    if (seen.has(id)) invalid(`duplicate model "${id}".`);
    seen.add(id);
    const thinkingLevels = entry.thinkingLevels ?? knownLevels(id);
    if (!Array.isArray(thinkingLevels) || !thinkingLevels.length || thinkingLevels.some(x => !LEVELS.includes(x)) || new Set(thinkingLevels).size !== thinkingLevels.length) {
      invalid(`model "${id}" needs distinct supported thinkingLevels.`);
    }
    const reasoning = entry.reasoning ?? config.reasoning;
    if (reasoning !== undefined && !thinkingLevels.includes(reasoning)) invalid(`model "${id}" does not support default reasoning "${reasoning}".`);
    positive(entry.contextWindow, 'contextWindow');
    positive(entry.maxTokens, 'model maxTokens');
    if (entry.googleSearch !== undefined && typeof entry.googleSearch !== 'boolean') invalid('model googleSearch must be boolean.');
    return { ...entry, id, name: entry.name || id, thinkingLevels: LEVELS.filter(x => thinkingLevels.includes(x)), reasoning };
  });
  config.retryPolicy = resolveRetryPolicy(config.retryPolicy, 'lazydsh/gemini.retryPolicy');
  return config;
}
