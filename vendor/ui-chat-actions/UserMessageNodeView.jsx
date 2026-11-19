// Adapted from @deepseek-ai/dsh-client-ui-chat 0.2.2-rc.3 (MIT).
// See ../../THIRD_PARTY_NOTICES.md.
import { useMemo } from 'react';
import { MessageIconActions } from './MessageIconActions.tsx';

export function UserMessageNodeView({ node, renderFactorySlot, loadImage, renderSlotChain, t, extraActions, editor }) {
  const data = node.data;
  const prepared = useMemo(() => {
    const texts = [], attachments = [], extraBlocks = [];
    for (const block of data.content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
      else if (block.type === 'image' && block.attachment !== undefined) attachments.push({ type: 'image', image: { attachment: block.attachment } });
      else if (block.type === 'file' && block.attachment !== undefined) attachments.push({ type: 'file', file: block.attachment });
      else extraBlocks.push(block);
    }
    return { text: texts.join(''), attachments, extraBlocks,
      ...(data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }) };
  }, [data.content, data.referenceLabels]);
  const facts = useMemo(() => ({
    ...(data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels }),
    ...(data.skillNames === undefined ? {} : { skillNames: data.skillNames }),
  }), [data.referenceLabels, data.skillNames]);
  return <div className="lazydsh-user-row">
    {renderSlotChain?.('conversation.chat.user.before', { source: data.source, kind: node.kind }, { fallback: null })}
    {editor}
    {renderFactorySlot('conversation.chat.user.content', {
      content: editor ? { ...prepared, text: '' } : prepared,
      loadImage, facts, interactive: !editor,
    })}
    {!editor && <MessageIconActions text={prepared.text} time={data.time} clock="start" t={t} extraActions={extraActions} />}
  </div>;
}
