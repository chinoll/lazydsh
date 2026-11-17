// SPDX-License-Identifier: GPL-3.0-only
export const styles = `
.lazydsh-links { color: var(--dsw-alias-text-primary, inherit); font: inherit; font-size: 13px; line-height: 1.6; min-width: 0; }
.lazydsh-links summary { display: flex; align-items: center; gap: 6px; width: fit-content; min-height: 36px; cursor: pointer; list-style: none; border-radius: 4px; }
.lazydsh-links summary::-webkit-details-marker { display: none; }
.lazydsh-links summary:hover, .lazydsh-links a:hover { text-decoration: underline; text-underline-offset: 3px; }
.lazydsh-links summary:focus-visible, .lazydsh-links a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.lazydsh-chevron { display: inline-block; font-size: 18px; transform: rotate(-90deg); }
.lazydsh-links[open] > summary .lazydsh-chevron, .lazydsh-unread[open] > summary .lazydsh-chevron { transform: none; }
.lazydsh-note { margin: 8px 0 16px; max-width: 70ch; }
.lazydsh-links section { margin: 16px 0; }
.lazydsh-links h4 { font-size: inherit; font-weight: 600; margin: 0 0 6px; }
.lazydsh-links ul { list-style: none; padding: 0; margin: 0; }
.lazydsh-links li { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 0; overflow-wrap: anywhere; min-width: 0; }
.lazydsh-links a { color: inherit; text-decoration: underline; text-underline-offset: 3px; max-width: 100%; }
.lazydsh-url { font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lazydsh-status { font-size: 12px; }
@media (max-width: 640px) { .lazydsh-links summary { min-height: 44px; } .lazydsh-links a { padding: 4px 0; } }
`;
