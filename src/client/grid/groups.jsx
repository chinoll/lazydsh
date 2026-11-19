// SPDX-License-Identifier: GPL-3.0-only
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

function GroupIcon({ kind = 'grid' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {kind === 'grid' ? <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/></>
      : <path d={kind === 'add' ? 'M12 4v16M4 12h16' : kind === 'edit' ? 'm14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z' : 'm6 6 12 12M6 18 18 6'} />}
  </svg>;
}
function GroupRow({ group, active, grid }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(group.name);
  const cancelled = useRef(false);
  const count = group.layout.cells.slice(0, group.layout.count).filter(Boolean).length;
  function save() { if (!cancelled.current) grid.renameGroup(group.id, draft); setEditing(false); }
  return <li className="lazydsh-group-row" data-active={active} data-group-id={group.id}>
    {editing ? <form onSubmit={event => { event.preventDefault(); save(); }}>
      <input aria-label="分屏组名称" autoFocus value={draft} maxLength={80} onFocus={e => e.target.select()}
        onChange={e => setDraft(e.target.value)} onBlur={save} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; setEditing(false); }
        }} />
    </form> : <>
      <button type="button" className="lazydsh-group-select" aria-label={`打开分屏组 ${group.name}`} aria-current={active ? 'page' : undefined}
        title={`${group.name} · ${count} 个会话`} onClick={() => grid.selectGroup(group.id)}>
        <GroupIcon /><span className="lazydsh-group-name">{group.name}</span><span className="lazydsh-group-count" aria-hidden="true">{count}</span>
      </button>
      <span className="lazydsh-group-actions">
        <button type="button" aria-label={`重命名分屏组 ${group.name}`} title="重命名" onClick={() => { cancelled.current = false; setDraft(group.name); setEditing(true); }}><GroupIcon kind="edit" /></button>
        <button type="button" aria-label={`删除分屏组 ${group.name}`} title="删除分组，不删除会话" onClick={() => grid.deleteGroup(group.id)}><GroupIcon kind="close" /></button>
      </span>
    </>}
  </li>;
}
function GroupSection({ grid, activePanel }) {
  const state = useSyncExternalStore(grid.subscribe, grid.getSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  return <section className="lazydsh-group-section" aria-label="分屏组">
    <div className="lazydsh-group-heading">
      <button type="button" className="lazydsh-group-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true" style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}><path d="m3 4.5 3 3 3-3"/></svg>分屏组
      </button>
      <button type="button" aria-label="新建分屏组" title="新建分屏组" onClick={() => { setCollapsed(false); grid.createGroup(); }}><GroupIcon kind="add" /></button>
    </div>
    {!collapsed && (state.groups.length ? <ul>{state.groups.map(group => <GroupRow key={group.id} group={group} grid={grid}
      active={state.enabled && activePanel === null && state.groupId === group.id} />)}</ul>
      : <p className="lazydsh-groups-empty">右键会话选择「分屏」，或点击 + 新建</p>)}
  </section>;
}
// The native sidebar has no additive section slot. Its footer entry supplies
// the real expanded/collapsed state; place this section before the workspace
// region inside the existing scrollport, preserving the native workspace tree.
export function GroupSidebar({ wide, grid, layout, usePanelInfo }) {
  const panel = usePanelInfo(s => s.activePanelId);
  const [host, setHost] = useState(null);
  useLayoutEffect(() => {
    if (!wide) return;
    const mount = document.createElement('div'); mount.className = 'lazydsh-groups-mount';
    let container, workspace;
    function clearAnchors() { container?.removeAttribute('data-lazydsh-groups'); workspace?.removeAttribute('data-lazydsh-workspace-region'); }
    function attach() {
      if (mount.isConnected) return;
      const scrollport = document.querySelector('[data-sidebar-scrollport]');
      const header = scrollport?.querySelector('[data-sidebar-workspace-header]');
      if (!header) return;
      let region = header;
      while (region.parentElement && region.parentElement !== scrollport) region = region.parentElement;
      clearAnchors(); container = scrollport; workspace = region;
      container.setAttribute('data-lazydsh-groups', ''); workspace.setAttribute('data-lazydsh-workspace-region', '');
      scrollport.insertBefore(mount, region); setHost(mount);
    }
    attach();
    const observer = new MutationObserver(attach); observer.observe(document.body, { subtree: true, childList: true });
    return () => { observer.disconnect(); clearAnchors(); mount.remove(); setHost(null); };
  }, [wide]);
  if (!wide) return <button type="button" className="lazydsh-groups-rail" aria-label="展开分屏组" title="分屏组" onClick={() => layout.toggleSidebar()}><GroupIcon /></button>;
  return host ? createPortal(<GroupSection grid={grid} activePanel={panel} />, host) : null;
}
