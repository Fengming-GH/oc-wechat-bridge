# WeChat Bridge Commands / 微信桥接指令

所有指令通过微信发送给 Bot，以 `/` 开头。中英文别名均可识别（如 `/stop` 和 `/停止` 等价）。

带数字参数的指令支持无空格写法：`/switch3` 与 `/switch 3` 等价。

---

## Quick Reference / 指令一览

| 指令 | 别名 | 功能 | 示例 |
|------|------|------|------|
| `/stop` | `/停止` | 中断 AI 任务 | `/stop` |
| `/status` | `/状态` | 查看所有目录和会话 | `/status` |
| `/switch <N\|ID>` | `/切换 <N\|ID>` | 切换到指定会话 | `/switch 3` |
| `/new [N]` | `/新建 [N]` | 创建新会话 | `/new 2` |
| `/unbind` | `/解绑` | 解绑当前会话 | `/unbind` |
| `/rename <标题>` | `/改名 <标题>` | 修改会话标题 | `/rename 项目讨论` |
| `/mode` | `/模式` | 查看当前会话模式（只读） | `/mode` |
| `/help` | `/帮助` | 显示指令列表 | `/help` |

**审批指令：** AI 需要权限时直接回复 `同意` 或 `拒绝`（也支持 `yes`/`no`/`y`/`n`）。

---

## /stop — Abort AI Task / 中断 AI 任务

中断当前正在进行的 AI 回复。

**Syntax:**
```
/stop
/停止
```

---

## /status — Bridge Status / 桥接状态

查看所有项目目录中的会话，按目录分组，全局连续编号。当前绑定的会话标记 `[当前会话]`。

**Syntax:**
```
/status
/状态
```

**Example (unbound):**
```
📁 GitHub-OCPlugins — 3 个会话
  1. 📱WeChat插件
  2. 改造计划审查
  3. 📱微信
📁 BT-Valve — 1 个会话
  4. 编译 4.1 版本
```

**Example (bound):**
```
📁 GitHub-OCPlugins — 3 个会话
  1. 📱WeChat插件 [当前会话]
  2. 改造计划审查
  3. 📱微信
📁 BT-Valve — 1 个会话
  4. 编译 4.1 版本
```

**Notes:**
- 目录来自 `findProjectDirs()`：扫描 `{worktree}/../` 中所有带 `.opencode/` 的目录
- 编号全局连续，可用于 `/switch`
- 无绑定会话时不隐藏任何目录

---

## /switch — Switch Session / 切换当前会话

切换到指定会话（跨目录支持）。可通过全局编号或 session ID 前缀查找。切换后自动绑定，清空待选的 `/new` 目录上下文。

**Syntax:**
```
/switch <number|id>
/切换 <编号|ID>
```

**Alias (no space):** `/switch3`

**Example:**
```
# 按编号切换
用户: /switch 3
Bot: ✅ 已切换到会话: Bug修复

# 按 ID 前缀切换
用户: /switch ses_abc
Bot: ✅ 已切换到会话: 功能开发
```

---

## /new — Create New Session / 创建新会话

创建一个新的 OC 会话，标题自动设为 `📱微信-{senderId}`。

**Syntax:**
```
/new             (创建到上次 /switch 的会话所在目录)
/new <number>    (创建到指定会话编号所在目录)
/新建 <编号>
```

**Alias (no space):** `/new3`

**Example:**
```
用户: /new
Bot: ✅ 已创建新会话 [📱微信-o9cq80-T (ses_xxxx…)]

# 在 BT-Valve 目录创建：
用户: /new 1
Bot: ✅ 已创建新会话 [📱微信-o9cq80-T (ses_xxxx…)]
```

**Notes:**
- 如果不指定编号，则创建到当前绑定会话的目录；无绑定时创建到第一个目录
- `/new 3` 的编号是 `/status` 显示的全局编号，会话创建到该编号所在目录

---

## /unbind — Unbind Session / 解绑会话

解绑当前微信与 OC 会话的绑定。解绑后后续消息将创建新会话，旧会话保留在 OC 中不受影响。

**Syntax:**
```
/unbind
/解绑
```

---

## /rename — Rename Session / 修改会话标题

修改当前绑定会话的标题。标题会自动恢复微信图标前缀。

**Syntax:**
```
/rename <new title>
/改名 <新标题>
```

**Notes:**
- 修改后 Bot 自动补上 📱 前缀

---

## /mode — Read Session Mode / 查询会话模式

从最新一条 AI 回复中读取当前会话的 mode（`plan` 或 `build`）。**只读**，不支持通过插件切换模式。

**Syntax:**
```
/mode
/模式
```

**Note:** 如需切换模式请在 OC 终端输入 `/mode plan` 或 `/mode build`。

> **原因：** OC 没有服务端 API 可以切换 session mode，`/mode` 是客户端的 slash 命令，只能在 TUI 里输入。

---

## /help — Command List / 指令列表

显示所有可用指令。

**Syntax:**
```
/help
/帮助
```

---

## Permission Approval / 权限审批

AI 需要调用工具时，会通过微信向你确认：

```
需要确认：读取文件 package.json？
回复 同意 或 拒绝
```

直接回复 `同意`（或 `yes`/`y`）即可批准，回复 `拒绝`（或 `no`/`n`）即拒绝。5 分钟无回复自动拒绝。

也支持 `/confirm` 和 `/deny` 的原始指令格式。

---

## Message Flow / 消息流程

### Direct Chat / 直接对话

```
用户发送普通文本 → Bot 收到 → 创建/复用 OC 会话 → AI 回复 → 回复发回微信
```

1. 用户发 `你好`
2. Bot 创建会话 `📱微信-xxx`
3. AI 处理后回复 → Bot 转发到微信
4. 之后的消息复用该会话

### Multi-directory / 多目录操作

```
用户: /status            → 查看所有目录和会话
用户: /switch 3          → 直接切换到全局编号 3 的会话
用户: /status            → 确认已绑定
用户: /new               → 在当前会话所在目录创建新会话
用户: /new 1             → 在指定目录创建新会话
```

### Permission Approval / 权限审批

```
AI 请求使用工具 → Bot 发微信通知
用户回复 同意          → AI 继续执行
用户回复 拒绝          → AI 放弃执行（5 分钟超时自动拒绝）
```

---

## Notes / 注意事项

| 特性 | 说明 |
|------|------|
| **会话持久化** | `wechatSid` 映射保存在 `{worktree}/.opencode/plugins/wechat-bridge/session-map.json`，重启后恢复 |
| **首次消息超时** | 首次消息指导语发出后 10 分钟未收到二次消息，视为新用户重新接待 |
| **无空格参数** | `/switch3` 与 `/switch 3` 等价，所有带数字参数的指令都支持 |
| **凭据位置** | 登录凭据保存在 `~/.opencode/wechat-bridge/account.json`，跨项目共享 |
| **日志文件** | `.opencode/plugins/log/wechat-bridge.log` |
