// SPDX-License-Identifier: GPL-3.0-only
import { automaticLayout, resizeRects, tile, validRects } from './geometry.js';
export const panelId = 'lazydsh-grid';
export const maxAxis = 6;
const storageKey = 'lazydsh.session-grid.v1';
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
  return { rows, columns, count, cells, rects, active: 0, enabled: false, notice: '' };
}
export function createGridController(ctx, storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
  let saved;
  try { saved = JSON.parse(storage?.getItem(storageKey) ?? 'null'); } catch {}
  let snapshot = restoreGrid(saved);
  const listeners = new Set(), loaded = new Map();
  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    try { storage?.setItem(storageKey, JSON.stringify(snapshot)); } catch {}
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
