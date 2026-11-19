// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createGridController, maxAxis, panelId } from './state.js';
import { gridStyles } from './styles.js';

function GridIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/></svg>;
}
function PaneIcon({ close }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={close ? 'm6 6 12 12M6 18 18 6' : 'M8 4h12v12M20 4 4 20'} /></svg>;
}
function OpenGrid({ grid, sessionId }) {
  return <button type="button" className="lazydsh-grid-open" title="会话分屏" aria-label="会话分屏" onClick={() => grid.open(sessionId)}><GridIcon /></button>;
}
function GridMenuItem({ grid, sessionId, useMenuOpenState }) {
  const [, close] = useMenuOpenState();
  return <button type="button" role="menuitem" onClick={() => { close(false); grid.open(sessionId); }}>在分屏中打开</button>;
}

// Each occurrence holds its own controller reference; releasing a pane never stops its Host Agent.
export function RetainedConversation({ sessionId, sessions, SessionProvider, renderSlot }) {
  const [state, setState] = useState({ id: null, reference: null, error: '' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let reference, live = true;
    setState({ id: sessionId, reference: null, error: '' });
    try {
      reference = sessions.retain(sessionId, { source: 'lazydshGrid' });
      reference.ready.then(() => {
        if (live) setState({ id: sessionId, reference, error: '' });
      }).catch(error => { if (live) setState({ id: sessionId, reference: null, error: error.message }); });
    } catch (error) { setState({ id: sessionId, reference: null, error: error.message }); }
    return () => { live = false; reference?.release(); };
  }, [sessionId, sessions, attempt]);
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

function Divider({ dimension, index, position, grid, surface }) {
  const drag = useRef(null);
  const vertical = dimension === 'columns';
  function move(event) {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const coordinate = vertical ? event.clientX : event.clientY;
    const { start, weight, size } = drag.current;
    grid.resize(dimension, index, weight + (coordinate - start) / size);
  }
  return <div role="separator" tabIndex={0} aria-label={vertical ? `调整第 ${index + 1} 列宽度` : `调整第 ${index + 1} 行高度`}
    aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(position * 100)} aria-valuemin={0} aria-valuemax={100}
    className={`lazydsh-grid-divider ${vertical ? 'vertical' : 'horizontal'}`} style={vertical ? { left: `${position * 100}%` } : { top: `${position * 100}%` }}
    onDoubleClick={() => grid.equalize()} onPointerDown={event => {
      if (event.button !== 0) return;
      const rect = surface.current.getBoundingClientRect(), state = grid.getSnapshot();
      drag.current = { pointerId: event.pointerId, start: vertical ? event.clientX : event.clientY, size: vertical ? rect.width : rect.height,
        weight: (vertical ? state.columnWeights : state.rowWeights)[index] };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }} onPointerMove={move} onPointerUp={event => { move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const step = event.key === (vertical ? 'ArrowLeft' : 'ArrowUp') ? -.03 : event.key === (vertical ? 'ArrowRight' : 'ArrowDown') ? .03 : 0;
      if (event.key === 'Home') { event.preventDefault(); grid.equalize(); }
      if (step) { event.preventDefault(); const state = grid.getSnapshot(); grid.resize(dimension, index, (vertical ? state.columnWeights : state.rowWeights)[index] + step); }
    }} />;
}
const presets = [['1x2', '左右两栏'], ['2x1', '上下两栏'], ['2x2', '四宫格'], ['2x3', '六宫格'], ['3x3', '九宫格']];
export function SessionGrid({ grid, sessions, useSessions, SessionProvider, renderSlot }) {
  const state = useSyncExternalStore(grid.subscribe, grid.getSnapshot), catalog = useSessions(s => s);
  const surface = useRef(null), paneRefs = useRef([]);
  const count = state.rows * state.columns, selected = state.cells.slice(0, count);
  useEffect(() => { paneRefs.current[state.active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [state.active]);
  const currentPreset = `${state.rows}x${state.columns}`;
  let width = 0, height = 0;
  return <div className="lazydsh-session-grid">
    <div className="lazydsh-grid-toolbar" role="group" aria-label="布局操作">
      <strong>会话分屏</strong>
      <select aria-label="分屏布局" value={presets.some(([value]) => value === currentPreset) ? currentPreset : 'custom'} onChange={event => {
        if (event.target.value === 'custom') return; const [rows, columns] = event.target.value.split('x').map(Number); grid.layout(rows, columns);
      }}>{presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">自定义</option></select>
      <label>行 <select aria-label="行数" value={state.rows} onChange={e => grid.layout(Number(e.target.value), state.columns)}>{Array.from({ length: maxAxis }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>列 <select aria-label="列数" value={state.columns} onChange={e => grid.layout(state.rows, Number(e.target.value))}>{Array.from({ length: maxAxis }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
      <button type="button" onClick={() => grid.equalize()}>均分</button>
      <button type="button" className="lazydsh-grid-exit" onClick={() => grid.single(selected[state.active] ?? selected.find(Boolean))}>退出分屏</button>
    </div>
    {state.notice && <div className="lazydsh-grid-notice" role="status">{state.notice}</div>}
    <div className="lazydsh-grid-viewport">
      <div className="lazydsh-grid-surface" ref={surface} style={{ gridTemplateColumns: state.columnWeights.map(n => `${n}fr`).join(' '), gridTemplateRows: state.rowWeights.map(n => `${n}fr`).join(' '), minWidth: state.columns * 300, minHeight: state.rows * 220 }}>
        {selected.map((sessionId, index) => <section key={index} ref={node => { paneRefs.current[index] = node; }} className="lazydsh-grid-pane" data-active={state.active === index} aria-label={`分屏 ${index + 1}`}
          onFocusCapture={() => grid.focus(index)} onPointerDownCapture={() => grid.focus(index)}>
          <div className="lazydsh-grid-pane-header">
            <select aria-label={`分屏 ${index + 1} 的会话`} value={sessionId ?? ''} title={catalog.byId[sessionId]?.displayTitle} onChange={e => grid.assign(index, e.target.value || null)}>
              <option value="">选择会话…</option>
              {sessionId && !catalog.byId[sessionId] && <option value={sessionId}>未找到会话 · {sessionId.slice(-8)}</option>}
              {catalog.ids.filter(id => catalog.byId[id]?.origin !== 'subagent').map(id => <option key={id} value={id} disabled={id !== sessionId && selected.includes(id)}>{catalog.byId[id].displayTitle || catalog.byId[id].title || id}{catalog.byId[id].running ? ' · 生成中' : ''}</option>)}
            </select>
            {sessionId && <><button type="button" title="单独打开此会话" aria-label="单独打开此会话" onClick={() => grid.single(sessionId)}><PaneIcon /></button><button type="button" title="移除此分屏中的会话" aria-label="移除此分屏中的会话" onClick={() => grid.assign(index, null)}><PaneIcon close /></button></>}
          </div>
          <div className="lazydsh-grid-pane-body">
            {sessionId ? <RetainedConversation key={sessionId} sessionId={sessionId} sessions={sessions} SessionProvider={SessionProvider} renderSlot={renderSlot} /> : <div className="lazydsh-grid-empty">在上方选择会话</div>}
          </div>
        </section>)}
        {state.columnWeights.slice(0, -1).map((value, index) => { width += value; return <Divider key={`column-${index}`} dimension="columns" index={index} position={width} grid={grid} surface={surface} />; })}
        {state.rowWeights.slice(0, -1).map((value, index) => { height += value; return <Divider key={`row-${index}`} dimension="rows" index={index} position={height} grid={grid} surface={surface} />; })}
      </div>
    </div>
  </div>;
}

export function applySessionGrid(ctx) {
  const grid = createGridController(ctx);
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = gridStyles; document.head.append(style); return () => style.remove(); });
  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: panelId, children: { 'lazydsh.grid.conversation': { kind: 'single', scope: 'session' } }, inject: () => ({ grid, sessions: ctx.sessions }) }, SessionGrid);
    yield ctx.slots.register({ name: 'lazydsh.grid.conversation' }, GridConversation);
  });
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: panelId, order: 300, inject: () => ({ grid }) }, OpenGrid));
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: panelId, order: 300, inject: () => ({ grid }) }, GridMenuItem));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: panelId, label: '会话分屏', order: 300 }, GridIcon));
  return grid;
}
