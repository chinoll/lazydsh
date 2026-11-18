// SPDX-License-Identifier: GPL-3.0-only
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { promptTurns, selectionOf } from './history.js';
import { registerVersionRpc } from './rpc.js';

const memberSchema = z.object({
  sessionId: z.string(), promptId: z.string(), turn: z.number().int().nonnegative(),
  requestId: z.string().optional(), createdAt: z.number(),
});
export const versionDomain = defineDomain({
  name: 'lazydsh_versions', version: 1,
  tables: { groups: domainTable(z.object({ members: z.array(memberSchema) })) },
});
const requestSchema = z.object({ sessionId: z.string().min(1).max(256) });
const regenerateSchema = requestSchema.extend({ turn: z.number().int().nonnegative(), requestId: z.string().uuid() });
const selectSchema = requestSchema.extend({ turn: z.number().int().nonnegative(), targetSessionId: z.string().min(1).max(256) });
const fail = message => { const error = new Error(message); error.userMessage = message; throw error; };

/** One group write is serialized, including generation admission, across browser tabs. */
export function createVersions(ctx, table) {
  const groupByPrompt = new Map();
  const locks = new Map();
  for (const [key, group] of table.entries()) {
    for (const member of group.members) groupByPrompt.set(member.promptId, key);
  }
  const groupOf = promptId => {
    const key = groupByPrompt.get(promptId);
    return key ? { key, group: table.get(key) } : { key: promptId, group: undefined };
  };
  async function inspect(sessionId, callback) {
    const observation = await ctx.sessionQuery.observeSession(sessionId);
    try {
      if (observation.header.origin === 'subagent' || observation.header.delegationDepth > 0) fail('子代理会话不支持重新生成。');
      return await callback(observation, promptTurns(observation.events));
    } finally { observation[Symbol.dispose](); }
  }
  function assertIdle(sessionId) {
    const agent = ctx.agents.get(sessionId);
    if (agent && (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length)) {
      fail('请等待当前生成和排队消息完成后再操作。');
    }
    if (ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) fail('请先恢复已归档的会话。');
  }
  async function list({ sessionId }) {
    return inspect(sessionId, (_, turns) => ({
      turns: Object.fromEntries(turns.filter(turn => turn.complete).map(turn => {
        const { group } = groupOf(turn.prompt.id);
        const members = group?.members ?? [{ sessionId, turn: turn.turn, promptId: turn.prompt.id }];
        const index = Math.max(0, members.findIndex(member => member.promptId === turn.prompt.id));
        return [turn.turn, { index, members: members.map(member => ({ sessionId: member.sessionId, turn: member.turn })),
          // Replaying later steering before its tool/assistant boundary would change the prompt.
          canRegenerate: !turn.steered,
          ...(turn.steered ? { reason: '这轮包含中途追加的提示，暂不支持整轮重新生成。' } : {}),
        }];
      })),
    }));
  }
  async function regenerate(request) {
    assertIdle(request.sessionId);
    return inspect(request.sessionId, async (observation, turns) => {
      const turn = turns.find(item => item.turn === request.turn && item.complete);
      if (!turn) fail('找不到这条提示词，或回答尚未结束。');
      if (turn.steered) fail('这轮包含中途追加的提示，暂不支持整轮重新生成。');
      const { key } = groupOf(turn.prompt.id);
      if (locks.has(key)) {
        await locks.get(key).catch(() => {});
        const previous = table.get(key)?.members.find(member => member.requestId === request.requestId);
        if (previous) return { sessionId: previous.sessionId };
        fail('这个提示词正在重新生成，请稍后再试。');
      }
      const operation = (async () => {
        const existing = table.get(key);
        const previous = existing?.members.find(member => member.requestId === request.requestId);
        if (previous) return { sessionId: previous.sessionId };
        assertIdle(request.sessionId);
        const selection = selectionOf(ctx.agents.get(request.sessionId)?.model.current()) ?? selectionOf(turn.selection);
        if (!selection) fail('请先选择可用的模型。');
        await ctx.llm.resolveCallConfig(selection);
        if (turn.startSeq < 1) fail('这条历史记录缺少可重放的会话起点。');
        // Fork before this turn: none of its answers or tool results reach the new version.
        const created = await ctx.sessionController.fork({ sessionId: request.sessionId, atSeq: turn.startSeq - 1 });
        const child = ctx.agents.get(created.sessionId);
        if (!child) fail('新版本创建后未就绪，请重新打开会话。');
        const prompt = createUserMessage({ content: structuredClone(turn.prompt.content),
          source: { kind: 'user', ...(turn.prompt.source.clientTimeZone ? { clientTimeZone: turn.prompt.source.clientTimeZone } : {}) } });
        const member = { sessionId: created.sessionId, promptId: prompt.id, turn: turn.turn,
          requestId: request.requestId, createdAt: Date.now() };
        try { await child.runMaintenance(async () => {
          // A fork can inherit queued inbox entries. Never run those again.
          child.inbox.clear();
          child.model.select(selection);
          const members = existing?.members ?? [{ sessionId: request.sessionId, promptId: turn.prompt.id,
            turn: turn.turn, createdAt: observation.header.createdAt ?? Date.now() }];
          const updated = { members: [...members, member] };
          await table.put(key, updated);
          for (const item of updated.members) groupByPrompt.set(item.promptId, key);
          // Preserve durable attachment refs; never reduce the prompt to rendered text.
          child.followup(prompt);
        }); } catch (error) {
          // A synchronous observer can throw after inbox admission. Only undo
          // the version record when no durable event admitted this prompt.
          const admitted = child.inbox.nextTurn.some(item => item.id === prompt.id)
            || child.session.events.some(event =>
              (event.type === 'user/message' && event.data.id === prompt.id)
              || (event.type === 'agent/inbox/spliced' && event.data.inserted.some(item => item.id === prompt.id)));
          if (!admitted && table.get(key)?.members.some(item => item.promptId === prompt.id)) {
            if (existing) await table.put(key, existing);
            else await table.delete(key);
            groupByPrompt.delete(prompt.id);
            if (!existing) groupByPrompt.delete(turn.prompt.id);
          }
          if (!admitted) throw error;
          ctx.logger.warn('lazydsh versions: prompt admitted despite observer failure: %s', error.message);
        }
        return { sessionId: created.sessionId };
      })();
      locks.set(key, operation);
      try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
    });
  }
  async function select(request) {
    assertIdle(request.sessionId);
    return inspect(request.sessionId, async (_, turns) => {
      const turn = turns.find(item => item.turn === request.turn);
      if (!turn) fail('找不到这个回答的版本记录。');
      const { group } = groupOf(turn.prompt.id);
      const member = group?.members.find(item => item.sessionId === request.targetSessionId);
      if (!member) fail('目标不属于这个提示词的回答版本。');
      await inspect(member.sessionId, () => undefined);
      return { sessionId: member.sessionId };
    });
  }
  return async (action, payload) => {
    const schema = action === 'regenerate' ? regenerateSchema : action === 'select' ? selectSchema : requestSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) fail('无效的会话或版本参数。');
    try { return await ({ list, regenerate, select })[action](parsed.data); }
    catch (error) {
      if (!error.userMessage) ctx.logger.warn('lazydsh versions: %s', error.message);
      throw error;
    }
  };
}

export function applyVersions(ctx) {
  ctx.inject(['connection', 'storageDomain', 'sessionQuery', 'sessionController', 'agents', 'workspaceRegistry'], async ctx => {
    const domain = await ctx.storageDomain.open(versionDomain);
    ctx.effect(() => () => domain.close());
    const handle = createVersions(ctx, domain.table('groups'));
    ctx.effect(() => registerVersionRpc(ctx.connection, handle));
  });
}
