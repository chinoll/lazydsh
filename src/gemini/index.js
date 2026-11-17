// SPDX-License-Identifier: GPL-3.0-only
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Config, plainConfig, resolveConfig, BASE_URL } from './config.js';
import { GoogleAdapter } from './adapter.js';
import { installSearchToolFilter } from './search-tools.js';

export { Config, GoogleAdapter };
export const name = 'llm-google-native';
export const inject = ['llm'];

export function apply(ctx, config) {
  const read = () => plainConfig(config);
  const initial = resolveConfig(read());
  installSearchToolFilter(ctx, () => resolveConfig(read()));
  const adapter = new GoogleAdapter({
    config: read,
    resolveApiKey: async current => {
      const ref = credentialRef(current.apiKeyEnv);
      const credentials = ctx.get('credentials');
      const value = credentials ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;
      if (!value) throw new LlmError(`Google Gemini: store ${ref} in DSH credentials or export it before launching DSH.`, 'MISSING_CREDENTIAL');
      return value;
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: ref => {
      const attachments = ctx.get('attachments');
      return attachments ? resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref) : undefined;
    },
  });
  const settingsNs = ctx.fiber.entry?.options.id ?? name;
  ctx.llm.registerConfigurableProviders([{
    provider: initial.provider, displayName: initial.displayName, settingsNs, settingsPath: [],
    defaultBaseURL: BASE_URL, nativeAuth: { env: [initial.apiKeyEnv], oauth: false },
  }]);
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => adapter.discoverModels(request, signal));
  const registration = ctx.llm.registerAdapter([initial.provider], adapter);
  ctx.on('internal/config', (fiber, next) => {
    const raw = next();
    if (fiber === ctx.fiber) resolveConfig(plainConfig(Config(raw)));
    return raw;
  });
  let previous = JSON.stringify(read());
  ctx.on('loader/volatile-update', () => {
    const current = JSON.stringify(read());
    if (current !== previous) {
      resolveConfig(read());
      registration.replace([initial.provider]);
      previous = current;
    }
  });
}
