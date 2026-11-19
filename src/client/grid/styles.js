// SPDX-License-Identifier: GPL-3.0-only
export const gridStyles = `
.lazydsh-session-grid { height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-base, inherit); }
.lazydsh-grid-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; padding-left: max(16px, var(--dsh-frame-leading-clearance, 0px)); border-bottom: 1px solid var(--dsw-alias-border-l3, #8885); flex-shrink: 0; font-size: 13px; }
.lazydsh-grid-toolbar strong { margin-right: 8px; font-weight: 500; }
.lazydsh-grid-toolbar label { display: inline-flex; align-items: center; gap: 4px; }
:is(.lazydsh-grid-toolbar, .lazydsh-grid-pane-header, .lazydsh-grid-empty) > :is(select, button), .lazydsh-grid-toolbar label > select { font: inherit; color: inherit; background: var(--dsw-alias-bg-base, transparent); border: 1px solid var(--dsw-alias-border-l3, #8885); border-radius: var(--dsw-radius-sm, 4px); min-height: 28px; }
:is(.lazydsh-grid-toolbar, .lazydsh-grid-pane-header) select { padding: 3px 6px; }
:is(.lazydsh-grid-toolbar, .lazydsh-grid-pane-header, .lazydsh-grid-empty) > button { cursor: pointer; padding: 3px 8px; }
:is(.lazydsh-grid-toolbar, .lazydsh-grid-pane-header, .lazydsh-grid-empty) > button:hover { background: var(--dsw-alias-interactive-bg-hover, #8882); }
.lazydsh-grid-toolbar .lazydsh-grid-exit { margin-left: auto; }
.lazydsh-grid-notice { padding: 8px 16px; font-size: 13px; }
.lazydsh-grid-viewport { flex: 1; min-height: 0; overflow: auto; }
.lazydsh-grid-surface { position: relative; display: grid; height: 100%; gap: 1px; background: var(--dsw-alias-border-l3, #8885); }
.lazydsh-grid-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base, inherit); }
.lazydsh-grid-pane-header { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l3, #8885); flex-shrink: 0; }
.lazydsh-grid-pane[data-active='true'] > .lazydsh-grid-pane-header { background: var(--dsw-alias-interactive-bg-hover, #8882); }
.lazydsh-grid-pane-header select { min-width: 0; flex: 1; text-overflow: ellipsis; font-size: 13px; }
.lazydsh-grid-pane-header button { border-color: transparent; display: inline-flex; align-items: center; justify-content: center; }
.lazydsh-grid-pane-body { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.lazydsh-grid-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 20px; font-size: 13px; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary, inherit); }
.lazydsh-grid-divider { position: absolute; z-index: 10; touch-action: none; }
.lazydsh-grid-divider.vertical { top: 0; bottom: 0; width: 7px; transform: translateX(-50%); cursor: col-resize; }
.lazydsh-grid-divider.horizontal { left: 0; right: 0; height: 7px; transform: translateY(-50%); cursor: row-resize; }
.lazydsh-grid-divider:hover, .lazydsh-grid-divider:focus-visible { background: var(--dsw-alias-interactive-bg-hover, #8885); }
:is(.lazydsh-grid-toolbar, .lazydsh-grid-pane-header, .lazydsh-grid-empty) :focus-visible, .lazydsh-grid-divider:focus-visible, .lazydsh-grid-open:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary, currentColor); outline-offset: -2px; }
.lazydsh-grid-open { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: var(--dsw-radius-sm, 4px); color: var(--dsw-alias-label-secondary, inherit); background: transparent; cursor: pointer; }
.lazydsh-grid-open:hover { background: var(--dsw-alias-interactive-bg-hover, #8882); }
`;
