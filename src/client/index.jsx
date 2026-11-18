// SPDX-License-Identifier: GPL-3.0-only
import { apply as applyLinks, inject as linksInject } from './links.jsx';
import { apply as applyModels, inject as modelsInject } from '../../vendor/ui-settings-models/src/client/index.ts';
import { applyVersionActions } from './versions.jsx';

export const inject = [...new Set([...linksInject, ...modelsInject, 'connection', 'sessions', 'uiWorkspace'])];
export function apply(ctx) {
  applyLinks(ctx);
  applyVersionActions(ctx);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = 'lazydsh-models';
    style.textContent = __LAZYDSH_MODELS_CSS__;
    document.head.append(style);
    return () => style.remove();
  });
  applyModels(ctx);
}
