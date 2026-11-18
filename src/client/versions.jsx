// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const initial = Object.freeze({ turns: {}, ready: false, error: null });

export function createVersionController(ctx) {
  const sources = new Map();
  const call = async (action, payload) => {
    const result = await ctx.connection.rpc.call('/api', `lazydsh/versions/${action}`, payload);
    if (!result.ok) throw new Error(result.error?.message ?? '操作未完成，请稍后重试。');
    return result.value;
  };
  function sourceFor(sessionId) {
    if (sources.has(sessionId)) return sources.get(sessionId);
    let snapshot = initial;
    let loading;
    const listeners = new Set();
    const publish = value => { snapshot = value; for (const listener of listeners) listener(); };
    const source = {
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      active: () => listeners.size > 0,
      getSnapshot: () => snapshot,
      refresh() {
        if (loading) return loading;
        loading = call('list', { sessionId })
          .then(value => publish({ ...value, ready: true, error: null }))
          .catch(error => publish({ ...snapshot, ready: true, error: error.message }))
          .finally(() => { loading = undefined; });
        return loading;
      },
      async regenerate(turn, requestId) {
        const result = await call('regenerate', { sessionId, turn, requestId });
        await source.refresh();
        await ctx.sessions.refresh();
        ctx.uiWorkspace.openSession(result.sessionId);
      },
      async select(turn, targetSessionId) {
        const result = await call('select', { sessionId, turn, targetSessionId });
        ctx.uiWorkspace.openSession(result.sessionId);
      },
    };
    sources.set(sessionId, source);
    return source;
  }
  ctx.effect(() => {
    const refresh = () => { for (const source of sources.values()) if (source.active()) void source.refresh(); };
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); sources.clear(); };
  });
  return { sourceFor };
}

function Icon({ kind }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'retry' ? <><path d="M20 7v5h-5" /><path d="M19.3 12a7.3 7.3 0 1 0-1.8 5" /></>
      : <path d={kind === 'prev' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} />}
  </svg>;
}

export function VersionActions({ turn, source, useSession, useAccess }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const running = useSession(session => session.running || session.pendingSubmissions.length > 0);
  const subagent = useSession(session => !!session.subagent);
  const allowed = useAccess('session/fork');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(null);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (allowed && !subagent && !running) void source.refresh(); }, [source, running, allowed, subagent, turn.turn]);
  const entry = snapshot.turns[turn.turn];
  async function perform(action) {
    if (working.current || running) return;
    working.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!allowed || subagent) return null;
  if (!snapshot.ready) return null;
  if (snapshot.error) return <div className="lazydsh-versions-error" role="status">
    版本信息加载失败 <button type="button" onClick={() => { void source.refresh(); }}>重试</button>
  </div>;
  if (!entry) return null;
  const blocked = busy || running;
  const hint = running ? '请等待生成完成' : entry.reason ?? '重新生成';
  return <div className="lazydsh-versions" aria-label="回答版本">
    <div className="lazydsh-version-controls" aria-busy={busy}>
      <button type="button" title={hint} aria-label="重新生成" disabled={blocked || !entry.canRegenerate}
        onClick={() => { void perform(async () => {
          requestId.current ??= crypto.randomUUID();
          await source.regenerate(turn.turn, requestId.current);
          requestId.current = null;
        }); }}><Icon kind="retry" /></button>
      {entry.members.length > 1 && <>
        <button type="button" title="上一个版本" aria-label="上一个版本" disabled={blocked || entry.index === 0}
          onClick={() => { void perform(() => source.select(turn.turn, entry.members[entry.index - 1].sessionId)); }}><Icon kind="prev" /></button>
        <span className="lazydsh-version-count" aria-live="polite">{entry.index + 1} / {entry.members.length}</span>
        <button type="button" title="下一个版本" aria-label="下一个版本" disabled={blocked || entry.index === entry.members.length - 1}
          onClick={() => { void perform(() => source.select(turn.turn, entry.members[entry.index + 1].sessionId)); }}><Icon kind="next" /></button>
      </>}
      {busy && <span role="status">处理中…</span>}
    </div>
    {error && <p className="lazydsh-versions-error" role="alert">{error}</p>}
  </div>;
}

export const versionStyles = `
.lazydsh-versions { color: var(--dsw-alias-label-secondary, inherit); font-size: var(--dsh-content-font-size-secondary, 13px); }
.lazydsh-version-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.lazydsh-version-controls button { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 5px; border: 0; border-radius: var(--dsw-radius-sm, 4px); background: transparent; color: inherit; cursor: pointer; }
.lazydsh-version-controls button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.12)); }
.lazydsh-version-controls button:focus-visible, .lazydsh-versions-error button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.lazydsh-version-controls button:disabled { opacity: .4; cursor: default; }
.lazydsh-version-count { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.lazydsh-versions-error { margin: 4px 0; font-size: 13px; overflow-wrap: anywhere; }
.lazydsh-versions-error button { color: inherit; font: inherit; background: transparent; border: 0; text-decoration: underline; cursor: pointer; }
@media (pointer: coarse) { .lazydsh-version-controls button { width: 44px; height: 44px; } }
`;

export function applyVersionActions(ctx) {
  const controller = createVersionController(ctx);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = versionStyles;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'lazydsh-versions', order: 100,
    inject: sessionId => ({ source: controller.sourceFor(sessionId) }),
  }, VersionActions));
}
