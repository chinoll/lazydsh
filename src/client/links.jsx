// SPDX-License-Identifier: GPL-3.0-only
import { useSyncExternalStore } from 'react';
import { sourcesDefinition, sourcesKey } from '../definition.js';
import { RelatedLinks } from './related-links.jsx';
import { styles } from './styles.js';

export const inject = ['slots', 'uiConversation', 'configForms'];
const empty = Object.freeze([]);

export function Footer({ turn, settings }) {
  const source = turn.data.source(sourcesKey);
  const rows = useSyncExternalStore(source.subscribe, source.getSnapshot) ?? empty;
  const config = useSyncExternalStore(settings.subscribe.bind(settings), settings.getSnapshot.bind(settings));
  if (config.status !== 'ready' || config.value?.showRelatedLinks === false) return null;
  return <RelatedLinks rows={rows} />;
}

export function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.uiConversation.events.register(sourcesDefinition);
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', id: 'lazydsh-related-links', order: 90,
    inject: () => ({ settings: ctx.configForms.get('lazydsh') }),
  }, Footer));
}
