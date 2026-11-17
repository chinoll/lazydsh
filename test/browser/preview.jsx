// SPDX-License-Identifier: GPL-3.0-only
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Footer } from '../../src/client/links.jsx';
import { styles } from '../../src/client/styles.js';
const rows = [
 {url:'https://example.com/guide',title:'API 使用说明（测试来源）',state:'read',detail:'fetched'},
 {url:'https://example.com/partial',title:'已截断的长网页',state:'read',detail:'partial'},
 {url:'https://example.org/search',title:'只有搜索摘要的结果',state:'unread',detail:'snippet'},
 {url:'https://example.org/denied',title:'拒绝访问的网页',state:'unread',detail:'failed'},
 {url:'https://example.net/archive',title:'没有读入凭据的旧记录',state:'unknown',detail:'unknown'},
 {url:'https://example.net/'+'long-path-'.repeat(30),title:'含有很长 URL 的搜索来源',state:'unread',detail:'snippet'},
];
let snapshot={status:'ready',value:{showRelatedLinks: true}};
const listeners=new Set();
const settings={subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snapshot};
const source={subscribe:()=>()=>{},getSnapshot:()=>rows};
const turn={data:{source:()=>source}};
function App(){const [enabled,setEnabled]=useState(true);return <main>
<h1>回复来源预览</h1><p>界面测试数据，不是真实检索结果。</p>
<label><input type="checkbox" checked={enabled} onChange={e=>{const value=e.target.checked;setEnabled(value);snapshot={...snapshot,value:{showRelatedLinks:value}};for(const l of listeners)l()}}/> 显示相关链接</label>
<article><p>这是一段用于验证回复末尾折叠区的示例回答。</p><Footer turn={turn} settings={settings}/></article>
</main>}
document.head.appendChild(Object.assign(document.createElement('style'),{textContent:styles+`body{font-family:system-ui,sans-serif;margin:0;color:#282828;background:#fff}main{max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:20px}article{margin-top:32px}label{display:block;padding:10px 0}@media(prefers-color-scheme:dark){body{color:#ededed;background:#181818}}`}));
createRoot(document.getElementById('root')).render(<App/>);
