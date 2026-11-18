# lazydsh

自己维护的 DeepSeek Harness 插件。公开仓库：<https://github.com/chinoll/lazydsh>。

## 回答版本与重新生成

从 0.3.0 开始，普通对话每轮回答下方自动提供 **重新生成** 按钮，无需开启设置。有多个版本时显示左右箭头和 `1 / 2` 版本编号，点击切换。

重新生成保留原提示词和附件，使用当前选中的模型，从该轮开始之前的上下文重新回答；不会带入被替换的回答或其工具结果。每个版本的后续对话独立保留，版本关系持久保存，重启后仍可切换。相关链接随所选版本显示。

底层使用 DSH 原生会话分支保存版本，因此这些分支也会出现在会话列表中，不需要手动 fork。生成中或有排队消息时暂时禁用操作；包含中途追加提示的轮次暂不支持重新生成。子代理会话不显示这些按钮，已归档会话需要先恢复。

## 原生 Gemini

从 0.2.0 开始，原 `dsh-gemini` 的功能直接内置在 lazydsh 中，不再依赖单独安装该插件：

- Google 原生 API、模型发现、模型配置和思考档位。
- Google Search 与 URL Context 网页读取；开启时不向该模型注入 DSH 的 `web_search` / `web_fetch`。
- 本地工具调用、图像输入、流式响应，以及 Google 签名和原生工具结果的历史重放。
- 沿用 DSH 的模型设置页和凭据管理，API Key 不写入项目。

默认 Base URL：`https://generativelanguage.googleapis.com/v1beta`。模型、API Key 引用和搜索开关仍在 **设置 → 模型 → Google Gemini (Native)** 中管理；相关链接开关独立保留。

### 从 dsh-gemini 迁移

安装 lazydsh 0.2.0 时，移除 profile 中独立的 `dsh-gemini` bundle 和依赖。保留原配置条目的 ID `llm-google-native`，只将插件名从 `dsh-gemini` 改为 `lazydsh/gemini`，原 `config` 内容保持不变。先备份 profile 的 `package.json`、锁文件和 `cordis.patch.yml`，避免两个 bundle 同时注册同一个提供方。

提供方 ID `google-native`、设置命名空间和历史重放格式保持兼容。无需重建模型配置、凭据或会话；桌面版重启后加载新插件。

## 相关链接

每轮回复结束后，在回答末尾增加默认收起的 **相关链接**。使用 SVG 箭头指示收起／展开，点击或使用键盘查看本轮工具记录中的来源：

- **已读入的来源**：网页内容已进入模型请求、Google URL Context 返回读取成功，或 Google 明确标记搜索内容已用于回答。截断的网页单独标明。
- **未读入正文的链接**：默认单独折叠隐藏，按需展开。包括只返回搜索摘要、读取失败、未收到读取结果，或结果未进入后续模型请求。
- **无法确认**：旧会话缺少读入凭据、工具结果被改写／移出上下文，或 Google 返回了来源但没有确认使用。

设置 → 插件 → lazydsh 的配置中提供独立开关 `showRelatedLinks`（默认开启）。关闭后隐藏所有回复的链接区；不影响搜索和抓取能力。配置保存在 DSH profile 中，重启后保留。

普通链接只显示标题和网址，只有截断、失败等特殊情况额外标注；不会在每个链接下重复读入状态或显示解释段落。

支持 DSH 的 `web_search` / `web_fetch`，以及内置 Gemini 和旧 `dsh-gemini` 保存的 Google 原生搜索和 URL Context 元数据。重复网页合并，查询参数保留，页内锚点不重复计数。无来源链接的回复不显示空列表。已保存的会话可以重新打开查看。

### 状态的含义和边界

“读入”指工具内容进入实际模型请求，或 Google 提供了使用／读取成功的证据，无法证明模型在内部逐字阅读。搜索摘要与网页正文分别标注；抓取成功本身不会直接被判定为模型已读入。

插件在 LLM 请求边界比较工具输出指纹，将结果 ID 和是否原样传入记为 DSH 的可忽略插件记录。仅在后续存在模型回复时采用该凭据；页面正文和提示词不会额外保存。安装前的 DSH 工具调用没有这种凭据，会保守显示为无法确认。Google 原生元数据仍可用于历史会话。

只展示 API 或工具实际公开的 URL。Google 隐藏的候选网页、仅有搜索建议 HTML、模型自己写出的链接，以及自定义工具内部未公开的搜索结果均不推测。新生成的 Gemini 回复统一使用折叠区展示来源，不再追加来源正文；旧会话原有正文保持原样。

该功能使用 DSH 官方 `conversation.chat.turnTail` 槽位和会话数据扩展，不修改回答正文、模型上下文或 Gemini 签名重放数据。卸载插件后，DSH 可以跳过插件记录继续使用原会话。

## 安装

要求 Node.js 24+、DSH `0.2.2-rc.3`（兼容范围 `<0.2.3-0`）。

```sh
npm ci
npm pack
```

在 DSH 的插件管理页面安装生成的 `lazydsh-0.3.0.tgz`。桌面版通过桌面插件管理器管理 profile；CLI 用户可使用 `dsh plugin add /path/to/lazydsh-0.3.0.tgz`。

## 开发与构建

```sh
npm ci
npm run check
```

`check` 检查宿主和 Gemini 插件入口的 JavaScript 语法，并构建浏览器入口。

源码入口：`src/index.js`（插件入口）、`src/versions/`（版本管理）、`src/providers/gemini/index.js`（原生 Gemini）、`src/client/index.jsx`（统一界面）；构建产物 `lib/client.js` 随安装包分发。第三方来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### Provider 目录

每个提供方的完整接入独立放在 `src/providers/<provider>/`，包含入口、配置、请求转换、传输和流式响应处理。其中 `adapter.js` 负责协议适配。当前 Gemini 的全部实现位于 `src/providers/gemini/`；后续提供方可以建立同级目录，再添加对应的包导出和 bundle 配置条目。

公开插件入口仍为 `lazydsh/gemini`，目录调整不需要修改已有 profile 或会话配置。

## 许可证

GNU General Public License v3.0 only（SPDX: `GPL-3.0-only`），见 [LICENSE](LICENSE)。
