// SPDX-License-Identifier: GPL-3.0-only
import { symbols } from '@deepseek-ai/cordis';

export const NATIVE_WEB_REPLACEMENTS = new Set(['web_search', 'web_fetch']);

export function usesGoogleSearch(config, selection) {
  if (selection?.provider !== config.provider) return false;
  const model = config.models.find(entry => entry.id === selection.model);
  return model !== undefined && (model.googleSearch ?? config.googleSearch);
}

// DSH rc.3 has no admission-filter registration API. Wrap the per-step resolver,
// preserving its conditions and scope checks, instead of restricting the shared
// registry (which would also affect other models and child agents).
export function installSearchToolFilter(ctx, readConfig) {
  ctx.inject(['tools'], ctx => {
    const service = ctx.tools[symbols.original];
    const descriptor = Object.getOwnPropertyDescriptor(service, 'resolve');
    const resolve = service.resolve;
    let enabled = true;
    async function resolveWithoutDuplicateSearch(context) {
      const exclude = enabled && usesGoogleSearch(readConfig(), context.modelSelection);
      const toolSet = await resolve.call(this, context);
      if (!exclude) return toolSet;
      return Object.freeze({
        dispose: () => toolSet.dispose(),
        view(scope) {
          const visible = new Map(toolSet.view(scope));
          for (const name of NATIVE_WEB_REPLACEMENTS) visible.delete(name);
          return visible;
        },
      });
    }
    Object.defineProperty(service, 'resolve', {
      configurable: true, writable: true, value: resolveWithoutDuplicateSearch,
    });
    ctx.effect(() => () => {
      enabled = false;
      // Leave later wrappers intact; this wrapper becomes a pass-through if
      // another plugin still holds it after our effect is disposed.
      if (service.resolve !== resolveWithoutDuplicateSearch) return;
      if (descriptor) Object.defineProperty(service, 'resolve', descriptor);
      else delete service.resolve;
    });
  });
}
