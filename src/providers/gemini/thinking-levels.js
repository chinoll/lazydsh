// SPDX-License-Identifier: GPL-3.0-only
export const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// Conservative fallback for future models. Explicit per-model metadata takes precedence.
export function knownLevels(id) {
  if (/^gemini-3-pro(?:-|$)/.test(id)) return ['low', 'high'];
  if (/^gemini-(?:3\.1-pro|3\.[78]-flash|4-(?:carbon|argon))(?:-|$)/.test(id)) return ['low', 'medium', 'high'];
  if (/^gemini-4-hydrogen(?:-|$)/.test(id)) return ['low', 'medium', 'high', 'xhigh'];
  if (/^gemini-(?:3-flash|3\.1-flash-lite|3\.5-flash(?:-lite)?|3\.6-flash)(?:-|$)/.test(id)) return ['minimal', 'low', 'medium', 'high'];
  return ['low', 'high'];
}

