// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { UserMessageNodeView } from '../../vendor/ui-chat-actions/UserMessageNodeView.jsx';

const initial = Object.freeze({ turns: {}, ready: false, error: null });

export function createVersionController(ctx, grid) {
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
      async regenerate(turn, requestId, text) {
        const result = await call('regenerate', { sessionId, turn, requestId, ...(text === undefined ? {} : { text }) });
        await source.refresh();
        await ctx.sessions.refresh();
        if (!grid?.navigate(sessionId, result.sessionId)) ctx.uiWorkspace.openSession(result.sessionId);
      },
      async select(turn, targetSessionId) {
        const result = await call('select', { sessionId, turn, targetSessionId });
        if (!grid?.navigate(sessionId, result.sessionId)) ctx.uiWorkspace.openSession(result.sessionId);
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
      : kind === 'edit' ? <><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></>
      : <path d={kind === 'prev' ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} />}
  </svg>;
}

export function versionForMessage(snapshot, messageId) {
  const found = Object.entries(snapshot.turns).find(([, entry]) => entry.promptId === messageId || entry.answerIds?.includes(messageId));
  return found ? { turn: Number(found[0]), entry: found[1] } : {};
}

export function VersionActions({ messageId, source, useSession, useAccess, onEdit }) {
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
  useEffect(() => { if (allowed && !subagent && !running) void source.refresh(); }, [source, running, allowed, subagent, messageId]);
  const { turn, entry } = versionForMessage(snapshot, messageId);
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
  if (snapshot.error) return <span className="lazydsh-versions-error" role="status">
    版本信息加载失败 <button type="button" onClick={() => { void source.refresh(); }}>重试</button>
  </span>;
  if (!entry) return null;
  const blocked = busy || running;
  const hint = running ? '请等待生成完成' : entry.reason ?? '重新生成';
  return <span className="lazydsh-versions" role="group" aria-label="回答版本">
    <span className="lazydsh-version-controls" aria-busy={busy}>
      <button type="button" title={hint} aria-label="重新生成" disabled={blocked || !entry.canRegenerate}
        onClick={() => { void perform(async () => {
          requestId.current ??= crypto.randomUUID();
          await source.regenerate(turn, requestId.current);
          requestId.current = null;
        }); }}><Icon kind="retry" /></button>
      {onEdit && <button type="button" title="编辑消息" aria-label="编辑消息" disabled={blocked || !entry.canRegenerate} onClick={onEdit}><Icon kind="edit" /></button>}
      {entry.members.length > 1 && <>
        <button type="button" title="上一个版本" aria-label="上一个版本" disabled={blocked || entry.index === 0}
          onClick={() => { void perform(() => source.select(turn, entry.members[entry.index - 1].sessionId)); }}><Icon kind="prev" /></button>
        <span className="lazydsh-version-count" aria-live="polite">{entry.index + 1} / {entry.members.length}</span>
        <button type="button" title="下一个版本" aria-label="下一个版本" disabled={blocked || entry.index === entry.members.length - 1}
          onClick={() => { void perform(() => source.select(turn, entry.members[entry.index + 1].sessionId)); }}><Icon kind="next" /></button>
      </>}
      {busy && <span role="status">处理中…</span>}
    </span>
    {error && <span className="lazydsh-versions-error" role="alert">{error}</span>}
  </span>;
}

function PromptEditor({ text, hasAttachments, turn, source, blocked, onCancel }) {
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  const working = useRef(false);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  async function submit(event) {
    event?.preventDefault();
    if (working.current || blocked || (!draft.trim() && !hasAttachments)) return;
    working.current = true;
    setBusy(true); setError(null);
    if (request.current?.text !== draft) request.current = { text: draft, id: crypto.randomUUID() };
    try {
      await source.regenerate(turn, request.current.id, draft);
      onCancel();
    } catch (failure) { setError(failure.message); }
    finally { working.current = false; setBusy(false); }
  }
  return <form className="lazydsh-prompt-editor" onSubmit={submit} aria-busy={busy}>
    <textarea ref={input} aria-label="编辑消息" value={draft} disabled={busy}
      onChange={event => setDraft(event.target.value)} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit(event);
      }} />
    {error && <span className="lazydsh-versions-error" role="alert">{error}</span>}
    <div className="lazydsh-editor-actions">
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="submit" disabled={busy || blocked || (!draft.trim() && !hasAttachments)}>{busy ? '正在生成…' : '保存并重新生成'}</button>
    </div>
  </form>;
}

export function UserVersionMessage(props) {
  const { node, source, useSession, useAccess } = props;
  const [editing, setEditing] = useState(false);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const { turn, entry } = versionForMessage(snapshot, node.data.messageId);
  const running = useSession(session => session.running || session.pendingSubmissions.length > 0);
  const allowed = useAccess('session/fork');
  const text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('');
  const editor = editing && entry && <PromptEditor text={text} turn={turn} source={source}
    hasAttachments={node.data.content.some(block => block.type === 'image' || block.type === 'file')}
    blocked={running || !allowed || !entry.canRegenerate} onCancel={() => setEditing(false)} />;
  return <UserMessageNodeView {...props} editor={editor}
    extraActions={<VersionActions messageId={node.data.messageId} source={source} useSession={useSession}
      useAccess={useAccess} onEdit={() => setEditing(true)} />} />;
}

export const versionStyles = `
.lazydsh-versions { display: inline-flex; align-items: center; flex-shrink: 0; gap: 8px; color: var(--dsw-alias-label-tertiary, inherit); font-size: var(--dsh-content-font-size-secondary, 13px); }
.lazydsh-version-controls { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.lazydsh-version-controls button { width: calc(28px + var(--dsh-content-font-delta, 0px)); height: calc(28px + var(--dsh-content-font-delta, 0px)); display: inline-flex; align-items: center; justify-content: center; padding: 6px; border: 0; border-radius: var(--dsw-radius-sm, 4px); background: transparent; color: inherit; cursor: pointer; }
.lazydsh-version-controls svg { width: calc(17px + var(--dsh-content-font-delta, 0px)); height: calc(17px + var(--dsh-content-font-delta, 0px)); flex-shrink: 0; }
.lazydsh-version-controls button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); color: var(--dsw-alias-label-secondary, inherit); }
.lazydsh-version-controls button:focus-visible, .lazydsh-versions-error button:focus-visible, .lazydsh-prompt-editor :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.lazydsh-version-controls button:disabled { opacity: .4; cursor: default; }
.lazydsh-version-count { text-align: center; font-variant-numeric: tabular-nums; }
.lazydsh-versions-error { font-size: 13px; overflow-wrap: anywhere; }
.lazydsh-versions-error button { color: inherit; font: inherit; background: transparent; border: 0; text-decoration: underline; cursor: pointer; }
.lazydsh-user-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.lazydsh-prompt-editor { width: min(100%, 640px); display: flex; flex-direction: column; gap: 8px; }
.lazydsh-prompt-editor textarea { box-sizing: border-box; width: 100%; min-height: 120px; resize: vertical; padding: 12px; font: inherit; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-layer-1, transparent); border: 1px solid var(--dsw-alias-border-main, currentColor); border-radius: var(--dsw-radius-sm, 4px); }
.lazydsh-editor-actions { display: flex; justify-content: flex-end; gap: 8px; }
.lazydsh-editor-actions button { padding: 6px 12px; font: inherit; color: inherit; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); border: 0; border-radius: var(--dsw-radius-sm, 4px); cursor: pointer; }
.lazydsh-editor-actions button:disabled { opacity: .4; cursor: default; }
`;

export function applyVersionActions(ctx, grid) {
  const controller = createVersionController(ctx, grid);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = versionStyles;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'lazydsh-versions', order: 100,
    inject: sessionId => ({ source: controller.sourceFor(sessionId) }),
  }, VersionActions));
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'user', locale: 'chat',
    children: { 'conversation.chat.user.before': { kind: 'chain', scope: 'session' } },
    inject: sessionId => ({ source: controller.sourceFor(sessionId) }),
  }, UserVersionMessage));
}
