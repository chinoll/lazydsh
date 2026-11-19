// SPDX-License-Identifier: GPL-3.0-only
const epsilon = 1e-7;
const near = (a, b) => Math.abs(a - b) < epsilon;
export function tile(count, rows, columns) {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / columns), size = Math.min(columns, count - row * columns);
    return { x: (i % columns) / size, y: row / rows, width: 1 / size, height: 1 / rows };
  });
}
export function validRects(rects, count) {
  if (!Array.isArray(rects) || rects.length !== count) return false;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const a = rects[i];
    if (!a || ![a.x, a.y, a.width, a.height].every(Number.isFinite)
      || a.x < 0 || a.y < 0 || a.width <= 0 || a.height <= 0 || a.x + a.width > 1 + epsilon || a.y + a.height > 1 + epsilon) return false;
    area += a.width * a.height;
    for (let j = 0; j < i; j++) {
      const b = rects[j];
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > epsilon
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > epsilon) return false;
    }
  }
  return near(area, 1);
}
// A seam affects only rectangles sharing its segment. At a T junction, include
// the adjoining rectangle's complete edge so resizing never leaves a hole.
export function seam(rects, index, dimension) {
  const coordinate = dimension === 'columns' ? 'x' : 'y', size = dimension === 'columns' ? 'width' : 'height';
  const cross = dimension === 'columns' ? 'y' : 'x', span = dimension === 'columns' ? 'height' : 'width';
  const origin = rects[index];
  const position = origin[coordinate] + origin[size];
  if (near(position, 1)) return null;
  let start = origin[cross], end = start + origin[span], changed = true;
  const before = new Set(), after = new Set();
  while (changed) {
    changed = false;
    rects.forEach((r, i) => {
      if (Math.min(end, r[cross] + r[span]) - Math.max(start, r[cross]) <= epsilon) return;
      const side = near(r[coordinate] + r[size], position) ? before : near(r[coordinate], position) ? after : null;
      if (!side || side.has(i)) return;
      side.add(i); start = Math.min(start, r[cross]); end = Math.max(end, r[cross] + r[span]); changed = true;
    });
  }
  return after.size ? { coordinate, size, position, start, end, before: [...before], after: [...after] } : null;
}
export function resizeRects(rects, index, dimension, delta) {
  const edge = seam(rects, index, dimension);
  if (!edge || !Number.isFinite(delta)) return rects;
  const { before, after, coordinate, size } = edge;
  const minimum = Math.min(.05, ...[...before, ...after].map(i => rects[i][size]));
  const lower = Math.max(...before.map(i => minimum - rects[i][size]));
  const upper = Math.min(...after.map(i => rects[i][size] - minimum));
  delta = Math.max(lower, Math.min(upper, delta));
  return rects.map((r, i) => before.includes(i) ? { ...r, [size]: r[size] + delta }
    : after.includes(i) ? { ...r, [coordinate]: r[coordinate] + delta, [size]: r[size] - delta } : r);
}
export function automaticLayout(count, vertical = false) {
  const columns = count <= 3 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return vertical ? { rows: columns, columns: rows } : { rows, columns };
}
