// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { seam } from './geometry.js';
import { createGridController, maxAxis, panelId } from './state.js';
import { gridStyles } from './styles.js';

function GridIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/></svg>;
}
function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>;
}
function OpenGrid({ grid, sessionId }) {
  return <button type="button" className="lazydsh-grid-open" title="会话分屏" aria-label="会话分屏" onClick={() => grid.open(sessionId)}><GridIcon /></button>;
}

// Each occurrence holds its own controller reference; releasing a pane never stops its Host Agent.
export function RetainedConversation({ sessionId, sessions, SessionProvider, renderSlot, grid }) {
  const [state, setState] = useState({ id: null, reference: null, error: '' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let reference, unmark, live = true;
    setState({ id: sessionId, reference: null, error: '' });
    try {
      reference = sessions.retain(sessionId, { source: 'lazydshGrid' });
      reference.ready.then(() => {
        if (live) { setState({ id: sessionId, reference, error: '' }); unmark = grid.ready(sessionId, reference); }
      }).catch(error => { if (live) setState({ id: sessionId, reference: null, error: error.message }); });
    } catch (error) { setState({ id: sessionId, reference: null, error: error.message }); }
    return () => { live = false; unmark?.(); reference?.release(); };
  }, [sessionId, sessions, attempt, grid]);
  if (state.id !== sessionId || !state.reference) return <div className="lazydsh-grid-empty" role="status">
    {state.id === sessionId && state.error ? <><span>会话加载失败：{state.error}</span><button type="button" onClick={() => retry(n => n + 1)}>重试</button></> : '正在加载会话…'}
  </div>;
  return <SessionProvider session={state.reference} empty={() => <div className="lazydsh-grid-empty">会话连接已断开，请重新选择会话。</div>}>
    {renderSlot('lazydsh.grid.conversation', {})}
  </SessionProvider>;
}

export function GridConversation({ useSession, useConversation, renderFactorySlot }) {
  const session = useSession(s => s), conversation = useConversation(s => s);
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running;
  const settling = !active && session.openState === 'loading';
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : active ? 'active' : 'hero', hero: !active && !settling });
}

function Divider({ dimension, index, edge, grid, surface }) {
  const drag = useRef(null), vertical = dimension === 'columns';
  function move(event) {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const { start, size, rects } = drag.current;
    grid.resize(index, dimension, ((vertical ? event.clientX : event.clientY) - start) / size, rects);
  }
  return <div role="separator" tabIndex={0} aria-label={`调整分屏 ${index + 1} 的${vertical ? '右侧' : '下方'}边界`}
    aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(edge.position * 100)} aria-valuemin={0} aria-valuemax={100}
    className={`lazydsh-grid-divider ${vertical ? 'vertical' : 'horizontal'}`} style={vertical
      ? { left: `${edge.position * 100}%`, top: `${edge.start * 100}%`, height: `${(edge.end - edge.start) * 100}%` }
      : { top: `${edge.position * 100}%`, left: `${edge.start * 100}%`, width: `${(edge.end - edge.start) * 100}%` }}
    onDoubleClick={() => grid.equalize()} onPointerDown={event => {
      if (event.button !== 0) return;
      const rect = surface.current.getBoundingClientRect();
      drag.current = { pointerId: event.pointerId, start: vertical ? event.clientX : event.clientY,
        size: vertical ? rect.width : rect.height, rects: grid.getSnapshot().rects };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }} onPointerMove={move} onPointerUp={event => { move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const step = event.key === (vertical ? 'ArrowLeft' : 'ArrowUp') ? -.03 : event.key === (vertical ? 'ArrowRight' : 'ArrowDown') ? .03 : 0;
      if (event.key === 'Home') { event.preventDefault(); grid.equalize(); }
      if (step) { event.preventDefault(); grid.resize(index, dimension, step); }
    }} />;
}
const presets = [['1x2', '左右两栏'], ['2x1', '上下两栏'], ['1x3', '左右三栏'], ['3x1', '上下三栏'], ['2x2', '四宫格'], ['2x3', '六宫格'], ['3x3', '九宫格']];
export function SessionGrid({ grid, sessions, useSessions, SessionProvider, renderSlot }) {
  const state = useSyncExternalStore(grid.subscribe, grid.getSnapshot), catalog = useSessions(s => s);
  const surface = useRef(null), paneRefs = useRef([]);
  const count = state.count, selected = state.cells.slice(0, count);
  useEffect(() => { paneRefs.current[state.active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [state.active]);
  const currentPreset = state.count === state.rows * state.columns ? `${state.rows}x${state.columns}` : 'auto';
  const focusPane = (event, index) => { if (!event.target.closest('[data-grid-close]')) grid.focus(index); };
  const edges = [], seen = new Set();
  state.rects.forEach((_, index) => {
    for (const dimension of ['columns', 'rows']) {
      const edge = seam(state.rects, index, dimension);
      if (!edge) continue;
      const key = `${dimension}:${edge.before.join(',')}:${edge.after.join(',')}`;
      if (!seen.has(key)) { seen.add(key); edges.push({ key, dimension, index, edge }); }
    }
  });
  return <div className="lazydsh-session-grid">
    <div className="lazydsh-grid-toolbar" role="group" aria-label="布局操作">
      <select aria-label="分屏布局" value={currentPreset === 'auto' || presets.some(([value]) => value === currentPreset) ? currentPreset : 'custom'} onChange={event => {
        if (['custom', 'auto'].includes(event.target.value)) return; const [rows, columns] = event.target.value.split('x').map(Number); grid.layout(rows, columns);
      }}>{currentPreset === 'auto' && <option value="auto">{state.count} 分屏</option>}{presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">自定义</option></select>
      <label>行 <select aria-label="行数" value={state.rows} onChange={e => grid.layout(Number(e.target.value), state.columns)}>{Array.from({ length: maxAxis }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>列 <select aria-label="列数" value={state.columns} onChange={e => grid.layout(state.rows, Number(e.target.value))}>{Array.from({ length: maxAxis }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <button type="button" onClick={() => grid.equalize()}>均分</button>
    </div>
    {state.notice && <div className="lazydsh-grid-notice" role="status">{state.notice}</div>}
    <div className="lazydsh-grid-viewport">
      <div className="lazydsh-grid-surface" ref={surface} style={{ minWidth: state.columns * 260, minHeight: state.rows * 200 }}>
        {selected.map((sessionId, index) => <section key={sessionId ?? `empty-${index}`} style={{ left: `${state.rects[index].x * 100}%`, top: `${state.rects[index].y * 100}%`, width: `${state.rects[index].width * 100}%`, height: `${state.rects[index].height * 100}%` }} ref={node => { paneRefs.current[index] = node; }} className="lazydsh-grid-pane" data-active={state.active === index} aria-label={`分屏 ${index + 1}`}
          onKeyDownCapture={event => focusPane(event, index)} onKeyUpCapture={event => { if (event.key === 'Tab') focusPane(event, index); }} onClickCapture={event => focusPane(event, index)}>
          <div className="lazydsh-grid-pane-header">
            <select aria-label={`分屏 ${index + 1} 的会话`} value={sessionId ?? ''} title={catalog.byId[sessionId]?.displayTitle} onChange={e => grid.assign(index, e.target.value || null)}>
              <option value="">选择会话…</option>
              {sessionId && !catalog.byId[sessionId] && <option value={sessionId}>未找到会话 · {sessionId.slice(-8)}</option>}
              {catalog.ids.filter(id => catalog.byId[id]?.origin !== 'subagent').map(id => <option key={id} value={id} disabled={id !== sessionId && selected.includes(id)}>{catalog.byId[id].displayTitle || catalog.byId[id].title || id}{catalog.byId[id].running ? ' · 生成中' : ''}</option>)}
            </select>
            <button type="button" data-grid-close="" title="关闭分屏" aria-label={`关闭分屏 ${index + 1}`} onClick={() => grid.close(index)}><CloseIcon /></button>
          </div>
          <div className="lazydsh-grid-pane-body">
            {sessionId ? <RetainedConversation key={sessionId} grid={grid} sessionId={sessionId} sessions={sessions} SessionProvider={SessionProvider} renderSlot={renderSlot} /> : <div className="lazydsh-grid-empty">在上方选择会话</div>}
          </div>
        </section>)}
        {edges.map(({ key, ...props }) => <Divider key={key} {...props} grid={grid} surface={surface} />)}
      </div>
    </div>
  </div>;
}

// Keep DSH's resident header, sidebar and their native session binding. Only the
// conversation body is covered; a portal preserves the grid's own React scope.
function GridHost({ grid, usePanelInfo, ...props }) {
  const state = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  const panel = usePanelInfo(s => s.activePanelId);
  const current = props.useSessions(s => s.ids.find(id => (s.byId[id]?.retainedBy?.mainView ?? 0) > 0));
  const [host, setHost] = useState(null);
  const previousSession = useRef(current);
  useLayoutEffect(() => {
    if (!state.enabled || panel !== null) return;
    const mount = document.createElement('div'); mount.className = 'lazydsh-grid-mount';
    let parent, root;
    const measure = () => {
      const header = root?.querySelector('header[data-window-drag]');
      if (header && parent) mount.style.top = `${header.getBoundingClientRect().bottom - parent.getBoundingClientRect().top}px`;
    };
    const sizing = new ResizeObserver(measure);
    const attach = () => {
      if (root?.isConnected && mount.parentElement === parent) return;
      const body = [...document.querySelectorAll('[data-conversation-content]')].find(node => !node.closest('.lazydsh-session-grid'));
      const next = body?.parentElement;
      if (!next) return;
      root?.removeAttribute('data-lazydsh-split');
      parent?.removeAttribute('data-lazydsh-grid-container');
      root = next; parent = root.parentElement;
      while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
      if (!parent) return;
      // The native conversation root changes with its Session binding. Anchor
      // the portal outside its scope wrappers so focus, clicks and drafts stay mounted.
      parent.setAttribute('data-lazydsh-grid-container', ''); root.setAttribute('data-lazydsh-split', '');
      if (mount.parentElement !== parent) parent.append(mount);
      sizing.disconnect(); sizing.observe(parent);
      const header = root.querySelector('header[data-window-drag]'); if (header) sizing.observe(header);
      measure(); setHost(mount);
    };
    attach();
    const observer = new MutationObserver(attach); observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); sizing.disconnect(); root?.removeAttribute('data-lazydsh-split'); parent?.removeAttribute('data-lazydsh-grid-container'); mount.remove(); setHost(null); };
  }, [state.enabled, panel]);
  useEffect(() => {
    const previous = previousSession.current; previousSession.current = current;
    if (current !== previous && state.enabled && panel === null) grid.follow(current);
  }, [grid, current, state.enabled, panel]);
  return host && state.enabled && panel === null ? createPortal(<SessionGrid grid={grid} {...props} />, host) : null;
}
function GridEntry({ grid }) {
  useEffect(() => { grid.open(); }, [grid]);
  return null;
}
export function applySessionGrid(ctx) {
  const grid = createGridController(ctx);
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = gridStyles; document.head.append(style); return () => style.remove(); });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId, inject: () => ({ grid }) }, GridEntry));
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({ name: 'shell.overlay', id: panelId, children: { 'lazydsh.grid.conversation': { kind: 'single', scope: 'session' } }, inject: () => ({ grid, sessions: ctx.sessions }) }, GridHost);
    yield ctx.slots.register({ name: 'lazydsh.grid.conversation' }, GridConversation);
  });
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: panelId, order: 300, inject: () => ({ grid }) }, OpenGrid));
  ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({ name: 'contextMenu.icon', key: panelId }, GridIcon));
  ctx.effect(() => ctx.contextMenus.register({
    id: panelId, target: 'session', order: 350,
    resolve: ({ sessionId }) => [{ id: 'split', label: '分屏', icon: { key: panelId }, run: () => grid.open(sessionId) }],
  }));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panelId, label: '会话分屏', order: 300 }, GridIcon));
  return grid;
}
