# lazydsh

由 [chinoll](https://github.com/chinoll) 独立维护的 DeepSeek Harness（DSH）插件项目。

当前为项目初始骨架，包含 Cordis 插件入口与 DSH bundle 配置，具体功能将在后续迭代中加入。

## 开发

环境要求：Node.js 24+、DSH `>=0.2.2-rc.3 <0.2.3-0`、Cordis 4.1。

```sh
git clone https://github.com/chinoll/lazydsh.git
cd lazydsh
npm run check
npm pack
```

当前入口仅使用宿主提供的 Cordis 上下文，无需构建即可打包。

## 安装

在 DSH 插件管理器中安装生成的 `lazydsh-0.1.0.tgz`。使用 CLI 管理的 profile 也可执行：

```sh
dsh plugin --profile web add /absolute/path/lazydsh-0.1.0.tgz
```

安装包中的 `cordis.patch.yml` 会挂载 `lazydsh` 插件。

## 项目结构

- `src/index.js`：插件入口。
- `cordis.patch.yml`：DSH bundle 挂载配置。
- `package.json`：包元数据、兼容范围与开发命令。

## 许可证

Copyright (C) 2026 chinoll.

本项目采用 **GNU General Public License v3.0 only**（SPDX：`GPL-3.0-only`）。完整条款见 [LICENSE](LICENSE)。
