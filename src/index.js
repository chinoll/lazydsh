// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 chinoll

import z from '@deepseek-ai/schemastery';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createReceiptTracker } from './receipts.js';
import { applyVersions } from './versions/index.js';

export const name = 'lazydsh';
export const inject = ['llm', 'settings'];
export const Config = z.object({
  showRelatedLinks: z.boolean().default(true)
    .description('显示相关链接：在回复末尾折叠展示已读入、未读入及无法确认的网页来源。'),
}).default({ showRelatedLinks: true }).volatile();

export function apply(ctx) {
  applyVersions(ctx);
  const tracker = createReceiptTracker();
  ctx.on('session/event', (session, event) => tracker.observe(session, event));
  ctx.on('llm/stream', async function* (options, next) {
    // Read the immutable request; plugin records never enter model context.
    if (!options.purpose && options.sessionId) {
      const session = ctx.get('agents')?.get(options.sessionId)?.session;
      const receipt = session && tracker.receipt(session, options.messages);
      if (receipt) {
        try { appendPluginRecord(session, 'plugin:lazydsh/request', receipt); }
        catch (error) { ctx.logger.warn('lazydsh: could not record source receipt: %s', error.message); }
      }
    }
    yield* next();
  });
}
