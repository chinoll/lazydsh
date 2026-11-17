// SPDX-License-Identifier: GPL-3.0-only
const labels = {
  partial: '内容已截断', failed: '读取失败',
  'not-admitted': '未进入模型请求', pending: '未收到读取结果',
};
function Chevron() {
  return <svg className="lazydsh-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>;
}
export function RelatedLinks({ rows }) {
  if (!rows.length) return null;
  return <details className="lazydsh-links">
    <summary><Chevron />相关链接 <span>({rows.length})</span></summary>
    {[['read', '已读入的来源'], ['unread', '未读入正文的链接'], ['unknown', '无法确认']].map(([state, title]) => {
      const items = rows.filter(row => row.state === state);
      if (!items.length) return null;
      const links = <ul>{items.map(row => <li key={row.url}>
          <a href={row.url} target="_blank" rel="noopener noreferrer" title={row.url}>{row.title}</a>
          <span className="lazydsh-url">{row.url}</span>
          {labels[row.detail] && <span className="lazydsh-status">{labels[row.detail]}</span>}
        </li>)}</ul>;
      return <section key={state} aria-label={title}>
        {state === 'unread' ? <details className="lazydsh-unread">
          <summary><Chevron />{title} <span>({items.length})</span></summary>
          {links}
        </details> : <><h4>{title} <span>({items.length})</span></h4>{links}</>}
      </section>;
    })}
  </details>;
}
