// SPDX-License-Identifier: GPL-3.0-only
import { useMemo } from 'react';
import { panelId } from './state.js';

const alias = name => `lazydsh.grid.native.${name}`;
export const headerSlot = alias('conversation.header');

// Native headers are ordinary owned Slots, not reusable Factories. Give their
// declaration tree a separate namespace while retaining the original components,
// session stores, injections and extension entries. Every outlet then inherits
// the pane's SessionProvider instead of the singleton main conversation binding.
export function installPaneHeaders(ctx) {
  function mirror(source, target) {
    return ctx.slots.inject(source, () => {
      const copies = new Map();
      function sync() {
        const entries = ctx.slots.entries(source).filter(entry => !(source === 'conversation.session.header.utilities' && entry.options.id === panelId));
        for (const [entry, dispose] of copies) if (!entries.includes(entry)) { copies.delete(entry); dispose(); }
        for (const entry of entries) {
          if (copies.has(entry)) continue;
          const Native = entry.component;
          function HeaderPart(props) {
            const renderSlot = useMemo(() => props.renderSlot && ((name, ...args) => props.renderSlot(alias(name), ...args)), [props.renderSlot]);
            const renderSlotChain = useMemo(() => props.renderSlotChain && ((name, ...args) => props.renderSlotChain(alias(name), ...args)), [props.renderSlotChain]);
            const content = <Native {...props} {...(renderSlot && { renderSlot })} {...(renderSlotChain && { renderSlotChain })} />;
            return source === 'conversation.session.header.actions' && entry.options.id === 'agent-preset'
              ? <span data-lazydsh-grid-mode="">{content}</span> : content;
          }
          const children = entry.children && Object.fromEntries(Object.entries(entry.children).map(([name, spec]) => [alias(name), spec]));
          const disposers = [];
          try {
            disposers.push(ctx.slots.register({ ...entry.options, name: target, store: entry.store, inject: entry.inject, locale: entry.locale,
              ...(children && { children }), ...(entry.select && { select: entry.select }) }, HeaderPart));
            for (const child of Object.keys(entry.children ?? {})) disposers.push(mirror(child, alias(child)));
          } catch (error) { for (const dispose of [...disposers].reverse()) dispose(); throw error; }
          copies.set(entry, () => { for (const dispose of [...disposers].reverse()) dispose(); });
        }
      }
      sync();
      const unsubscribe = ctx.slots.subscribe(source, sync);
      return () => { unsubscribe(); for (const dispose of copies.values()) dispose(); copies.clear(); };
    });
  }
  return mirror('conversation.header', headerSlot);
}
