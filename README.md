# lazydsh

自己维护的 DeepSeek Harness 插件。公开仓库：<https://github.com/chinoll/lazydsh>。

## 相关链接

每轮回复结束后，在回答末尾增加默认收起的 **⌄ 相关链接**。点击或使用键盘展开，查看本轮工具记录中的来源：

- **已读入的来源**：网页内容已进入模型请求、Google URL Context 返回读取成功，或 Google 明确标记搜索内容已用于回答。截断的网页单独标明。
- **未读入正文的链接**：默认单独折叠隐藏，按需展开。包括只返回搜索摘要、读取失败、未收到读取结果，或结果未进入后续模型请求。
- **无法确认**：旧会话缺少读入凭据、工具结果被改写／移出上下文，或 Google 返回了来源但没有确认使用。

设置 → 插件 → lazydsh 的配置中提供独立开关 `showRelatedLinks`（默认开启）。关闭后隐藏所有回复的链接区；不影响搜索和抓取能力。配置保存在 DSH profile 中，重启后保留。

支持 DSH 的 `web_search` / `web_fetch`，以及 `dsh-gemini` 保存的 Google 原生搜索和 URL Context 元数据。重复网页合并，查询参数保留，页内锚点不重复计数。无来源链接的回复不显示空列表。已保存的会话可以重新打开查看。

### 状态的含义和边界

“读入”指工具内容进入实际模型请求，或 Google 提供了使用／读取成功的证据，无法证明模型在内部逐字阅读。搜索摘要与网页正文分别标注；抓取成功本身不会直接被判定为模型已读入。

插件在 LLM 请求边界比较工具输出指纹，将结果 ID 和是否原样传入记为 DSH 的可忽略插件记录。仅在后续存在模型回复时采用该凭据；页面正文和提示词不会额外保存。安装前的 DSH 工具调用没有这种凭据，会保守显示为无法确认。Google 原生元数据仍可用于历史会话。

只展示 API 或工具实际公开的 URL。Google 隐藏的候选网页、仅有搜索建议 HTML、模型自己写出的链接，以及自定义工具内部未公开的搜索结果均不推测。此版本不会移除其他插件已有的来源正文。

该功能使用 DSH 官方 `conversation.chat.turnTail` 槽位和会话数据扩展，不修改回答正文、模型上下文或 Gemini 签名重放数据。卸载插件后，DSH 可以跳过插件记录继续使用原会话。

## 安装

要求 Node.js 24+、DSH `0.2.2-rc.3`（兼容范围 `<0.2.3-0`）。

```sh
npm ci
npm pack
```

在 DSH 的插件管理页面安装生成的 `lazydsh-0.1.1.tgz`。桌面版通过桌面插件管理器管理 profile；CLI 用户可使用 `dsh plugin add /path/to/lazydsh-0.1.1.tgz`。

## 开发与验证

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`check` 覆盖来源分类、请求凭据、真实 DSH Session 的历史保留和上下文隔离、官方 Conversation assembler 的历史回放与实时更新，并构建浏览器入口。浏览器测试覆盖默认折叠、键盘操作、独立开关、深色／浅色和窄屏布局，截图保存在 `dist/preview/`。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。

源码入口：`src/index.js`（宿主）、`src/client/index.jsx`（界面）；构建产物 `lib/client.js` 随安装包分发。

## 许可证

GNU General Public License v3.0 only（SPDX: `GPL-3.0-only`），见 [LICENSE](LICENSE)。
