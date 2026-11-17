// SPDX-License-Identifier: GPL-3.0-only
const labels = {
  fetched: '网页内容已读入', partial: '已读入部分内容（已截断）',
  grounded: 'Google 搜索内容已用于回答', 'native-fetch': 'Google 网页读取成功',
  snippet: '仅搜索摘要已读入，未读取正文', failed: '读取失败',
  'not-admitted': '未进入模型请求', pending: '未收到读取结果',
  'google-source': 'Google 返回来源，但未确认使用', unknown: '缺少读入记录，无法确认',
};
export function RelatedLinks({ rows }) {
  if (!rows.length) return null;
  return <details className="lazydsh-links">
    <summary><span className="lazydsh-chevron" aria-hidden="true">⌄</span>相关链接 <span>({rows.length})</span></summary>
    <p className="lazydsh-note">按工具记录区分；搜索摘要不等于网页正文。读入表示内容进入请求或 Google 确认使用，不代表模型逐字阅读。</p>
    {[['read', '已读入的来源'], ['unread', '未读入正文的链接'], ['unknown', '无法确认']].map(([state, title]) => {
      const items = rows.filter(row => row.state === state);
      if (!items.length) return null;
      const links = <ul>{items.map(row => <li key={row.url}>
          <a href={row.url} target="_blank" rel="noopener noreferrer" title={row.url}>{row.title}</a>
          <span className="lazydsh-url">{row.url}</span>
          <span className="lazydsh-status">{labels[row.detail] ?? labels.unknown}</span>
        </li>)}</ul>;
      return <section key={state} aria-label={title}>
        {state === 'unread' ? <details className="lazydsh-unread">
          <summary><span className="lazydsh-chevron" aria-hidden="true">⌄</span>{title} <span>({items.length})</span></summary>
          {links}
        </details> : <><h4>{title} <span>({items.length})</span></h4>{links}</>}
      </section>;
    })}
  </details>;
}
