// SPDX-License-Identifier: GPL-3.0-only
import { automaticLayout, resizeRects, tile, validRects } from './geometry.js';
export const panelId = 'lazydsh-grid';
export const maxAxis = 6;
const storageKey = 'lazydsh.session-groups.v2';
const legacyStorageKey = 'lazydsh.session-grid.v1';
const groupName = value => typeof value === 'string' ? value.trim().slice(0, 80) : '';
const layoutOf = ({ rows, columns, count, cells, rects, active }) => ({ rows, columns, count, cells, rects, active });
const axis = value => Number.isInteger(value) && value >= 1 && value <= maxAxis ? value : 1;
export function restoreGrid(raw) {
  const rows = axis(raw?.rows ?? 1), columns = axis(raw?.columns ?? 2);
  const count = Number.isInteger(raw?.count) && raw.count > (rows - 1) * columns && raw.count <= rows * columns ? raw.count : rows * columns;
  const seen = new Set();
  const cells = Array.from({ length: maxAxis ** 2 }, (_, i) => {
    const id = raw?.cells?.[i];
    if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id)) return null;
    seen.add(id); return id;
  });
  const rects = validRects(raw?.rects, count) ? raw.rects : tile(count, rows, columns);
  return { rows, columns, count, cells, rects, active: Number.isInteger(raw?.active) ? Math.max(0, Math.min(raw.active, count - 1)) : 0, enabled: false, notice: '' };
}
export function restoreGroups(raw, legacy) {
  const seen = new Set(), groups = [];
  if (Array.isArray(raw?.groups)) {
    for (const group of raw.groups) {
      if (typeof group?.id !== 'string' || !group.id || group.id.length > 128 || seen.has(group.id)) continue;
      seen.add(group.id);
      groups.push({ id: group.id, name: groupName(group.name) || `分屏组 ${groups.length + 1}`, layout: layoutOf(restoreGrid(group.layout)) });
    }
  } else if (restoreGrid(legacy).cells.some(Boolean)) {
    groups.push({ id: 'imported-grid', name: '分屏组 1', layout: layoutOf(restoreGrid(legacy)) });
  }
  const selected = groups.find(group => group.id === raw?.activeGroupId) ?? groups[0];
  return { ...restoreGrid(selected?.layout), groups, groupId: selected?.id ?? null };
}
export function createGridController(ctx, storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
  let saved, legacy;
  try { saved = JSON.parse(storage?.getItem(storageKey) ?? 'null'); } catch {}
  try { legacy = JSON.parse(storage?.getItem(legacyStorageKey) ?? 'null'); } catch {}
  let snapshot = restoreGroups(saved, legacy);
  const listeners = new Set(), loaded = new Map();
  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    if (snapshot.groupId) snapshot.groups = snapshot.groups.map(group => group.id === snapshot.groupId ? { ...group, layout: layoutOf(snapshot) } : group);
    try { storage?.setItem(storageKey, JSON.stringify({ version: 2, activeGroupId: snapshot.groupId, groups: snapshot.groups })); } catch {}
    for (const fn of listeners) fn();
  }
  function showActive() {
    const id = snapshot.cells[snapshot.active];
    if (id) {
      if ((!ctx.sessions || loaded.has(id)) && !(ctx.sessions?.list?.getSnapshot().byId[id]?.retainedBy?.mainView > 0)) ctx.uiWorkspace.openSession(id);
    }
    ctx.layout.selectPanel(null);
  }
  function arrange(count) {
    const { rows, columns } = automaticLayout(count, snapshot.columns === 1 && snapshot.rows > 1);
    return { count, rows, columns, rects: tile(count, rows, columns) };
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    createGroup(sessionId) {
      const catalog = ctx.sessions?.list?.getSnapshot();
      sessionId ??= catalog?.ids.find(id => catalog.byId[id]?.retainedBy?.mainView > 0);
      const fresh = restoreGrid();
      if (sessionId) fresh.cells[0] = sessionId;
      let number = 1;
      while (snapshot.groups.some(group => group.name === `分屏组 ${number}`)) number++;
      const id = globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const group = { id, name: `分屏组 ${number}`, layout: layoutOf(fresh) };
      publish({ ...fresh, groups: [...snapshot.groups, group], groupId: id, enabled: true });
      showActive();
      return id;
    },
    selectGroup(id) {
      const group = snapshot.groups.find(group => group.id === id);
      if (!group) return;
      publish({ ...restoreGrid(group.layout), groupId: id, enabled: true }); showActive();
    },
    renameGroup(id, name) {
      name = groupName(name);
      if (!name || !snapshot.groups.some(group => group.id === id)) return false;
      publish({ groups: snapshot.groups.map(group => group.id === id ? { ...group, name } : group) });
      return true;
    },
    deleteGroup(id) {
      const index = snapshot.groups.findIndex(group => group.id === id);
      if (index < 0) return;
      const groups = snapshot.groups.filter(group => group.id !== id);
      if (snapshot.groupId !== id) { publish({ groups }); return; }
      const next = groups[Math.min(index, groups.length - 1)];
      publish({ ...restoreGrid(next?.layout), groups, groupId: next?.id ?? null, enabled: Boolean(next) && snapshot.enabled });
      if (snapshot.enabled) showActive();
    },
    resume() {
      if (snapshot.groupId) controller.selectGroup(snapshot.groupId); else controller.createGroup();
    },
    ready(sessionId, reference) {
      loaded.set(sessionId, reference);
      if (snapshot.enabled && snapshot.cells[snapshot.active] === sessionId && ctx.layout.panelInfo.getSnapshot().activePanelId === null) showActive();
      return () => { if (loaded.get(sessionId) === reference) loaded.delete(sessionId); };
    },
    focus(index) {
      if (index < 0 || index >= snapshot.count || snapshot.active === index) return;
      publish({ active: index }); showActive();
    },
    layout(rows, columns) {
      rows = axis(rows); columns = axis(columns);
      const count = rows * columns;
      publish({ rows, columns, count, rects: tile(count, rows, columns), active: Math.min(snapshot.active, count - 1), notice: '' });
      showActive();
    },
    assign(index, sessionId) {
      if (index < 0 || index >= snapshot.count) return;
      const existing = snapshot.cells.slice(0, snapshot.count).indexOf(sessionId);
      if (sessionId && existing >= 0 && existing !== index) { controller.focus(existing); return; }
      const cells = snapshot.cells.map((id, i) => i === index ? sessionId : id === sessionId && sessionId !== null ? null : id);
      publish({ cells, active: index, notice: '' }); showActive();
    },
    resize(index, dimension, delta, original = snapshot.rects) {
      if (original.length !== snapshot.count) return;
      publish({ rects: resizeRects(original, index, dimension, delta) });
    },
    equalize() { publish({ rects: tile(snapshot.count, snapshot.rows, snapshot.columns) }); },
    open(sessionId) {
      if (!snapshot.enabled || !snapshot.groupId) { controller.createGroup(sessionId); return; }
      if (!sessionId && !snapshot.cells.slice(0, snapshot.count).some(Boolean)) {
        const catalog = ctx.sessions?.list?.getSnapshot();
        sessionId = catalog?.ids.find(id => catalog.byId[id]?.retainedBy?.mainView > 0);
      }
      if (sessionId) {
        const visible = snapshot.cells.slice(0, snapshot.count);
        const index = visible.indexOf(sessionId), empty = visible.indexOf(null);
        if (index >= 0) publish({ active: index, notice: '' });
        else if (empty >= 0) {
          const cells = snapshot.cells.map((id, i) => i === empty ? sessionId : id === sessionId ? null : id);
          publish({ cells, active: empty, notice: '' });
        } else if (snapshot.cells.every(Boolean) && !snapshot.cells.includes(sessionId)) {
          publish({ notice: '最多保存 36 个分屏会话。请先关闭一个分屏，再添加会话。' });
        } else if (snapshot.count < maxAxis ** 2) {
          const count = snapshot.count + 1, cells = [...snapshot.cells];
          // Preserve manually hidden sessions when expanding; insert the new one
          // at the next visible position instead of overwriting a hidden cell.
          const hidden = cells.slice(snapshot.count).filter(id => id && id !== sessionId);
          cells.splice(snapshot.count, cells.length - snapshot.count, sessionId, ...hidden);
          cells.length = maxAxis ** 2;
          publish({ ...arrange(count), cells: Array.from(cells, id => id ?? null), active: count - 1, notice: '' });
        } else publish({ notice: '最多支持 36 个分屏。请先关闭一个分屏，再添加会话。' });
      }
      publish({ enabled: true }); showActive();
    },
    close(index) {
      if (index < 0 || index >= snapshot.count) return;
      const cells = [...snapshot.cells]; cells.splice(index, 1); cells.push(null);
      if (snapshot.count === 1) { publish({ cells, enabled: false, notice: '' }); return; }
      const active = snapshot.active > index ? snapshot.active - 1 : Math.min(snapshot.active, snapshot.count - 2);
      publish({ ...arrange(snapshot.count - 1), cells, active, notice: '' }); showActive();
    },
    // Native sidebar navigation changes the selected session; keep its header
    // and selection, then route that session into the active pane.
    follow(sessionId) {
      if (!snapshot.enabled || !sessionId || snapshot.cells[snapshot.active] === sessionId) return;
      const index = snapshot.cells.slice(0, snapshot.count).indexOf(sessionId);
      if (index >= 0) publish({ active: index });
      else {
        const cells = snapshot.cells.map((id, i) => i === snapshot.active ? sessionId : id === sessionId ? null : id);
        publish({ cells, notice: '' });
      }
    },
    navigate(from, target) {
      if (!snapshot.enabled || ctx.layout.panelInfo.getSnapshot().activePanelId !== null) return false;
      const visible = snapshot.cells.slice(0, snapshot.count), index = visible.indexOf(from);
      if (index < 0) return false;
      const existing = visible.indexOf(target);
      if (existing >= 0) controller.focus(existing); else controller.assign(index, target);
      return true;
    },
  };
  return controller;
}
