# OC Plugins

OpenCode 插件合集，已全部开源到 GitHub。

## 目录

- [GitHub 组织](#github-组织)
- [插件列表](#插件列表)
- [快速开始](#快速开始)
  - [前置条件](#前置条件)
  - [通过 npm 安装（推荐）](#通过-npm-安装推荐)
  - [通过本地文件安装](#通过本地文件安装)
- [各插件详解](#各插件详解)
  - [0. oc-wechat-bridge - 微信双向桥接](#0-oc-wechat-bridge---微信双向桥接)
  - [1. oc-forward - 跨会话转发](#1-oc-forward---跨会话转发)
  - [2. oc-auto-continue - 自动续命](#2-oc-auto-continue---自动续命)
  - [3. oc-taskid-tracking - 子AI 延续追踪](#3-oc-taskid-tracking---子ai-延续追踪)
- [开发指南](#开发指南)
  - [本地开发](#本地开发)
  - [Git 推送（首次）](#git-推送首次)
  - [发布到 npm](#发布到-npm)
- [常见问题](#常见问题)
- [许可](#许可)

---

## GitHub 组织

所有插件托管在 GitHub 组织 **Fengming-GH** 下：

| 资源 | 链接 |
|:----|:-----|
| GitHub 组织主页 | https://github.com/Fengming-GH |
| BT-Valve 主项目 | https://github.com/Fengming-GH/BT-Valve |
| 本仓库 | https://github.com/Fengming-GH/oc-plugins |

## 插件列表

| # | npm 包名 | GitHub 仓库 | 版本 | 功能一句话 |
|:-:|:---------|:------------|:----|:----------|
| 1 | `@fengming-gh/oc-wechat-bridge` | [oc-wechat-bridge](https://github.com/Fengming-GH/oc-wechat-bridge) | v2.5.4 | 微信↔OC 双向桥接，流式输出，集成跨会话转发与自动续命。**零 npm 依赖，复制 `.ts` 即用** |
| 2 | `@fengming-gh/oc-forward` | [oc-forward](https://github.com/Fengming-GH/oc-forward) | v1.0.0 | 跨会话消息转发：`！` 指令，不阻塞源 AI |
| 3 | `@fengming-gh/oc-auto-continue` | [oc-auto-continue](https://github.com/Fengming-GH/oc-auto-continue) | v1.0.0 | 自动续命：terminated/API 错误后自动恢复 + 压缩后重读规则 |
| 4 | `@fengming-gh/oc-taskid-tracking` | [oc-taskid-tracking](https://github.com/Fengming-GH/oc-taskid-tracking) | v1.0.0 | 让子AI 带着上下文连续工作 |

## 项目状态

### 🟢 已完成

| # | 进展 | 说明 |
|:-:|:-----|:-----|
| 1 | 源码开发 | 3 个插件全部完成，各独立 GitHub 仓库包含完整 TypeScript 源码 + package.json + tsconfig.json |
| 2 | 插件文档 | 每个插件有中文详细版 README.md + 英文摘要版 README_EN.md |
| 3 | 本地部署 | BT-Valve 项目 `.opencode/plugins/` 下 3 个 `.ts` 文件运行中 |
| 4 | 缓存标题 | 插件自动填充 `_title` 字段，Session 文件人类可读 |

### 🟡 待办

| # | 待办项 | 原因 |
|:-:|:------|:-----|
| 1 | npm publish | 三个包的作用域 `@fengming-gh/` 已定，需注册 npm 账号后 `npm publish` |
| 2 | BT-Valve 切 npm 源 | 本地 `.opencode/plugins/` 文件 → `opencode.json` 的 `plugin` 字段引用 npm 包 |
| 3 | GitHub Action | 暂未添加（需确定自动化目标后再写 workflow） |

## 快速开始

### 前置条件

- OpenCode（版本 ≥ 1.15.10）
- npm 或 bun（OC 自动使用 bun 安装 npm 包）

### ⭐ oc-wechat-bridge：零依赖安装（复制即用）

`oc-wechat-bridge` 已改造为**零 npm 依赖**——只需复制一个 `.ts` 文件，不需要 `opencode.json` 配置，不需要 `npm install`。

**方式一：全局安装（所有项目可用）**

复制到 OC 全局插件目录：

```bash
# Windows
copy wechat-bridge.ts %USERPROFILE%\.opencode\plugins\wechat-bridge.ts

# macOS / Linux
cp wechat-bridge.ts ~/.opencode/plugins/wechat-bridge.ts
```

重启 OC 后所有项目自动加载。

**方式二：项目级安装（仅当前项目）**

复制到项目目录：

```bash
# Windows
copy wechat-bridge.ts 你的项目\.opencode\plugins\wechat-bridge.ts

# macOS / Linux
cp wechat-bridge.ts 你的项目/.opencode/plugins/wechat-bridge.ts
```

重启 OC 后当前项目加载。

### 其他插件：通过 npm 安装（推荐）

在项目根目录的 `opencode.json` 中添加 `plugin` 字段：

```json
{
  "plugin": [
    "@fengming-gh/oc-forward",
    "@fengming-gh/oc-auto-continue",
    "@fengming-gh/oc-taskid-tracking"
  ]
}
```

**不需要手动 `npm install`。** OC 启动时自动检测 `plugin` 数组，用 bun 安装缺失的包并缓存到 `~/.cache/opencode/node_modules/`。

安装完成后重启 OC，插件即可生效。

### 其他插件：通过本地文件安装

如果不想用 npm，也可以直接把源码复制到项目目录：

```bash
# 将各插件的 src/index.ts 复制到项目 .opencode/plugins/ 下
cp oc-forward/src/index.ts          你的项目/.opencode/plugins/forward.ts
cp oc-auto-continue/src/index.ts     你的项目/.opencode/plugins/auto-continue.ts
cp oc-taskid-tracking/src/index.ts   你的项目/.opencode/plugins/taskID-tracking.ts
```

重启 OC 后自动加载。

## 各插件详解

### 0. oc-wechat-bridge - 微信双向桥接

**解决的问题：** 在微信里和 OpenCode AI 对话，AI 回复自动推送回微信。

**工作原理：**

1. 启动时弹出微信二维码扫码登录
2. 长轮询接收微信消息 → 注入 OC 会话 → AI 处理 → 流式输出（思考、工具、文字实时推回微信）
3. 支持 `/switch` 切换绑定的 OC 会话、`/rename` 改名、`/status` 查看状态
4. 集成了 [oc-forward](https://github.com/Fengming-GH/oc-forward)（跨会话转发）和 [oc-auto-continue](https://github.com/Fengming-GH/oc-auto-continue)（自动续命 + 压缩重读）

**安装（两种方式）：**

| 方式 | 命令 |
|:----|:-----|
| **全局（所有项目）** | 复制 `.ts` 到 `~/.opencode/plugins/wechat-bridge.ts` |
| **项目级** | 复制 `.ts` 到 `项目/.opencode/plugins/wechat-bridge.ts` |

**零依赖说明：** 该插件已内联所有运行时依赖（`tool` 函数），仅使用 Node.js 内置模块（`node:crypto`、`node:fs`、`node:path`、`node:url`、`node:child_process`）。基于微信官方 iLink Bot API 开发，非逆向/非破解。不需要 `package.json`、`node_modules/`、`npm install`。复制 `.ts` 文件即用。

**首次使用：**

1. 放好 `.ts` 文件后重启 OC
2. 浏览器自动弹出微信二维码
3. 扫码登录（如果已登录过，自动复用凭据）
4. 从微信发送消息即可开始对话

**微信支持的命令：**

| 命令 | 功能 |
|:----|:-----|
| `/status` 或 `/状态` | 查看当前绑定的 OC 会话 |
| `/switch N` 或 `/切换 N` | 切换到编号为 N 的会话 |
| `/new` | 创建新会话 |
| `/rename 新名字` | 重命名当前会话 |
| `/unbind` | 解绑当前会话 |
| `/stop` | 中断 AI 回复 |
| `/help` | 查看帮助 |

### 1. oc-forward - 跨会话转发

**解决的问题：** OpenCode 的每个主会话是隔离的。当你有多个会话同时运行时（如"研发"、"项目经理"、"OC 插件"），AI 没法把消息从一个会话转发到另一个。

**工作原理：**

1. 插件监听 `session.created / updated / deleted` 事件，维护一个 **会话标题 → sessionID** 的缓存
2. 通过 `experimental.chat.system.transform` 钩子，把当前所有会话列表注入到 AI 的系统提示词中
3. 用户输入 `！会话` 或 `！<前缀> <消息>` 时，AI 调用 `forward_to_session` 工具转发消息

**用法：**

```
用户输入：！会话
→ AI 调用 list_sessions 列出当前所有会话

用户输入：！研发 编译烧录过了吗？
→ AI 调用 forward_to_session(prefix="研发", message="编译烧录过了吗？")
→ 目标会话收到：[转发自「OC 插件」] 编译烧录过了吗？

用户输入：！项目经理 看一下这个 Bug
→ AI 转发给标题以「项目经理」开头的会话
```

**注意：**
- `！` 是**全角**感叹号，`!` 是**半角**，两者都支持
- 转发是 fire-and-forget 模式，**不阻塞源 AI**（源 AI 发送后立即继续自己的工作）
- `noReply: false` 确保目标 AI 收到消息后**自动回复**

### 2. oc-auto-continue - 自动续命

**解决的问题：** AI 会话经常因为各种原因意外中断（API 错误、输出超长、被用户 terminated），需要手动点"继续"才能恢复。插件自动检测中断并续命。

**工作原理：**

1. 监听 `message.updated` 事件，检测 assistant 消息是否有错误
2. 如果错误类型在 `CONTINUE_ERRORS` 集合中，标记该会话为 pending
3. 监听 `session.idle` 事件，如果会话 idle 且 pending，自动发送续命消息
4. 监听 `session.compacted` 事件，上下文压缩后自动发送重读规则消息

**支持的续命场景：**

| 错误类型 | 触发条件 | 自动行为 |
|:---------|:---------|:---------|
| `MessageOutputLengthError` | AI 输出达到 token 上限 | 自动发送 "continue" |
| `APIError` | 云端 API 调用失败 | 自动发送 "continue" |
| `UnknownError` | 被用户 terminated | 发送 "侦测到 terminated，继续你刚才的工作" |

**压缩续命：**

当 OC 因上下文超长执行 context compaction 时，插件自动发送：
```
[上下文已压缩] 请重新读取项目根目录下的 AGENTS.md 以恢复项目上下文和规则。
```

**日志：**

插件在 `.opencode/plugins/log/auto-continue.log` 中记录所有事件（开始加载、消息完成、续命发送、压缩处理）。

### 3. oc-taskid-tracking - 子AI 延续追踪

**解决的问题：** 主 AI 调用子 AI（通过 `task()` 工具）后，需要记住子 AI 的 sessionID 才能下次延续对话。手动记录麻烦且容易丢。同时要防止调用非团队成员（如系统内置的 `explore`、`developer` 等 agent）。

**工作原理：**

1. **`tool.execute.before` 钩子：** 每次调 `task()` 前：
   - **白名单拦截：** 检查 `.opencode/agents/` 下是否存在对应的 agent 文件，不存在则抛错拒绝
   - **首次写盘：** 如果该 agent 在本会话中还没有记录，写入 `{ task_id: null }` 占位，标记"已调过但还没返回"

2. **`tool.execute.after` 钩子：** 每次 `task()` 返回后：
   - 从 output metadata 中提取子 AI 的 sessionID
   - 如果 task_id 变了，**覆盖写入**最新值（幂等保护，不变不写）

3. **`delegate(agent)` 工具：** 主 AI 查指定子 AI 是否已有延续会话

**白名单机制：**

`.opencode/agents/` 目录天然是白名单。每个团队成员对应一个 `.md` 文件：

```
.opencode/agents/
├── 架构师-孔明.md
├── 审查-魏征.md
├── 文档-曹子建.md
├── 项目-张良.md
├── 研发-关羽.md
├── 研发-黄忠.md
├── 研发-马超.md
├── 研发-张飞.md
├── 研发-子龙.md
├── 硬件-鲁班.md
└── 测试-宋慈.md
```

加人 = 放文件，删人 = 删文件，零配置。

**数据存储：**

```
Session/
└── ses_xxx（sessionID 命名）
```

```json
{
  "测试-宋慈": { "task_id": "ses_abc123" },
  "审查-魏征": { "task_id": "ses_def456" },
  "_title": "当前会话标题"
}
```

磁盘写入采用**原子写入**（先写 `.tmp` 再 `rename`），崩溃不残留半截 JSON。

**安全性：**
- 路径穿越防护：正则 `/^[a-zA-Z0-9_-]+$/` + `resolve().startsWith(resolve())` 双重校验
- JSON 结构异常：loadSession 校验类型，异常返回空对象 `{}`

## 常见问题

### Q：插件安装了但工具不可见？

OC 的自定义工具（`tool()` 注册的）只在插件加载**后**创建的会话中可见。如果当前会话是在安装插件之前创建的，需要重启 OC 或创建新会话。

### Q：如何查看插件日志？

每个插件在 `.opencode/plugins/log/` 下有独立日志文件（通过 npm 安装时在 OC 缓存目录下）：

| 插件 | 日志文件 |
|:----|:---------|
| forward | `forward.log` |
| auto-continue | `auto-continue.log` |
| taskid-tracking | 无日志（成功静默，失败 `console.warn`） |

### Q：如何调试插件？

- 检查 OC 日志：`~/.local/share/opencode/log/`（Windows 按 Win+R → `%USERPROFILE%\.local\share\opencode\log`）
- 插件内使用 `console.warn()` / `console.error()` 输出，在 OC 终端可见
- 在 `opencode.json` 中临时移除插件可排除问题

## 许可

MIT License。随意使用、修改、分发。
