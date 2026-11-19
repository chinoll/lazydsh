// SPDX-License-Identifier: GPL-3.0-only
export const panelId = 'lazydsh-grid';
export const maxAxis = 6;
const storageKey = 'lazydsh.session-grid.v1';
const axis = value => Number.isInteger(value) && value >= 1 && value <= maxAxis ? value : 1;
const even = size => Array(size).fill(1 / size);
function weights(value, size) {
  if (!Array.isArray(value) || value.length !== size || value.some(n => !Number.isFinite(n) || n <= 0)) return even(size);
  const sum = value.reduce((a, b) => a + b, 0);
  return Number.isFinite(sum) && sum > 0 ? value.map(n => n / sum) : even(size);
}
export function restoreGrid(raw) {
  const rows = axis(raw?.rows ?? 1), columns = axis(raw?.columns ?? 2);
  const seen = new Set();
  const cells = Array.from({ length: maxAxis ** 2 }, (_, i) => {
    const id = raw?.cells?.[i];
    if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id)) return null;
    seen.add(id); return id;
  });
  return { rows, columns, cells, rowWeights: weights(raw?.rowWeights, rows), columnWeights: weights(raw?.columnWeights, columns), active: 0, notice: '' };
}
export function createGridController(ctx, storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
  let saved;
  try { saved = JSON.parse(storage?.getItem(storageKey) ?? 'null'); } catch {}
  let snapshot = restoreGrid(saved);
  const listeners = new Set();
  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    try { storage?.setItem(storageKey, JSON.stringify(snapshot)); } catch {}
    for (const fn of listeners) fn();
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    focus(index) { if (snapshot.active !== index) publish({ active: index }); },
    layout(rows, columns) {
      rows = axis(rows); columns = axis(columns);
      publish({ rows, columns, rowWeights: even(rows), columnWeights: even(columns), active: Math.min(snapshot.active, rows * columns - 1), notice: '' });
    },
    assign(index, sessionId) {
      const cells = snapshot.cells.map((id, i) => i === index ? sessionId : id === sessionId && sessionId !== null ? null : id);
      publish({ cells, active: index, notice: '' });
    },
    resize(dimension, index, first) {
      const key = dimension === 'columns' ? 'columnWeights' : 'rowWeights';
      const values = [...snapshot[key]], pair = values[index] + values[index + 1];
      if (!Number.isFinite(first) || !Number.isFinite(pair)) return;
      values[index] = Math.max(pair * .1, Math.min(pair * .9, first));
      values[index + 1] = pair - values[index];
      publish({ [key]: values });
    },
    equalize() { publish({ rowWeights: even(snapshot.rows), columnWeights: even(snapshot.columns) }); },
    open(sessionId) {
      if (sessionId) {
        const visible = snapshot.cells.slice(0, snapshot.rows * snapshot.columns);
        const index = visible.indexOf(sessionId), empty = visible.indexOf(null);
        if (index >= 0) controller.focus(index);
        else if (empty >= 0) controller.assign(empty, sessionId);
        else publish({ notice: '网格已满。可增加行列，或在格子顶部选择要替换的会话。' });
      }
      ctx.layout.selectPanel(panelId);
    },
    navigate(from, target) {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== panelId) return false;
      const visible = snapshot.cells.slice(0, snapshot.rows * snapshot.columns), index = visible.indexOf(from);
      if (index < 0) return false;
      const existing = visible.indexOf(target);
      if (existing >= 0) controller.focus(existing); else controller.assign(index, target);
      return true;
    },
    single(sessionId) {
      if (sessionId) ctx.uiWorkspace.openSession(sessionId);
      else ctx.layout.selectPanel(null);
    },
  };
  return controller;
}
