# WeChat Bridge Commands / 微信桥接指令

所有指令通过微信发送给 Bot，以 `/` 开头。中英文别名均可识别（如 `/stop` 和 `/停止` 等价）。

带数字参数的指令支持无空格写法：`/join2` 与 `/join 2` 等价。

---

## Quick Reference / 指令一览

| 指令 | 别名 | 功能 | 示例 |
|------|------|------|------|
| `/stop` | `/停止` | 中断 AI 任务 | `/stop` |
| `/status` | `/状态` | 查看桥接状态 | `/status` |
| `/join N` | `/进入 N` | 进入项目目录 | `/join 2` |
| `/bind M` | `/绑定 M` | 在目录中绑定会话 | `/bind 3` |
| `/unbind` | `/解绑` | 解绑当前会话 | `/unbind` |
| `/rename <标题>` | `/改名 <标题>` | 修改会话标题 | `/rename 项目讨论` |
| `/new [N]` | `/新建 [N]` | 创建新会话 | `/new` |
| `/sessions` | `/会话` | 列出所有会话 | `/sessions` |
| `/switch <N\|ID>` | `/切换 <N\|ID>` | 切换到指定会话 | `/switch 3` |
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

**Example:**
```
用户: /stop
Bot: ✅ 已中断当前任务
```

---

## /status — Bridge Status / 桥接状态

查看当前项目目录、会话列表。当前绑定的会话标记 `[当前会话]`。

**Syntax:**
```
/status
/状态
```

**Example:**
```
用户: /status
Bot: 当前会话3个；目录：GitHub-OCPlugins
     1. WeChat插件
     2. 📱微信 [当前会话]
     3. 改造计划审查
```

---

## /join N — Enter Project Directory / 进入项目目录

进入第 N 个项目目录。进入后 `/new` 将在此目录创建会话，`/bind` 可绑定此目录中的会话。5 分钟无操作自动退出。

**Syntax:**
```
/join <number>
/进入 <编号>
```

**Alias (no space):** `/join2`, `/进入2`

**Example:**
```
用户: /sessions
Bot: 📁 GitHub-OCPlugins (3个):
      1. 微信-o9cq80-T ← 当前
     📁 MyProject (2个):
      2. 功能开发
      3. Bug修复
     回复 /switch <编号> 或 /join <编号> 切换目录

用户: /join 2
Bot: 已进入 📁 MyProject
     回复 /new 新建 /sessions 查看 /bind <编号> 绑定
```

**Notes:**
- 目录列表来自 `findProjectDirs()`：扫描 `{worktree}/../` 中所有带 `.opencode/` 的目录
- 目录编号与 `/sessions` 显示顺序一致
- 5 分钟超时后自动退出（通过 `/new` 或 `/bind` 成功也可清除）

---

## /bind M — Bind Session in Directory / 在已进入的目录中绑定会话

在 `/join` 已进入的目录上下文中，按全局编号绑定会话到当前微信用户。

**Syntax:**
```
/bind <number>
/绑定 <编号>
```

**Alias (no space):** `/bind3`, `/绑定5`

**Example:**
```
用户: /join 1
Bot: 已进入 📁 GitHub-OCPlugins

用户: /bind 2
Bot: ✅ 已绑定会话: 功能开发 (ses_xxxx…)
```

**Notes:**
- 编号是 `/sessions` 显示的全局编号（多目录时跨目录连续编号）
- 绑定成功后自动清除目录选择状态（`_joinDir = null`）

---

## /new — Create New Session / 创建新会话

在当前目录（或指定目录）创建一个新的 OC 会话，标题自动设为 `📱微信-{senderId}`。

**Syntax:**
```
/new             (当前目录)
/new <number>    (指定目录编号)
/新建 <编号>
```

**Alias (no space):** `/new2`

**Example:**
```
用户: /new
Bot: ✅ 已创建新会话 [📱微信-o9cq80-T (ses_xxxx…)]

# 在 MyProject 目录中创建：
用户: /new 2
Bot: ✅ 已创建新会话 [📱微信-o9cq80-T (ses_xxxx…)]
```

**Notes:**
- 如果不指定编号，且之前用过 `/join`，则在 `/join` 的目录中创建
- 创建成功后清除目录选择状态（`_joinDir = null`）

---

## /sessions — List All Sessions / 列出所有会话

列出所有项目目录中的顶层会话。单目录时平铺显示，多目录时按 📁 前缀分组，全局连续编号。

**Syntax:**
```
/sessions
/会话
```

**Single directory example:**
```
用户: /sessions
Bot: 📁 GitHub-OCPlugins (3个):
      1. 微信-o9cq80-T ← 当前
      2. 功能开发
      3. Bug修复
     回复 /switch <编号> 或 /join <编号> 切换目录
```

**Multiple directories example:**
```
用户: /sessions
Bot: 📁 GitHub-OCPlugins (3个):
      1. 微信-o9cq80-T ← 当前
      2. 功能开发
      3. Bug修复
     📁 MyProject (2个):
      4. 需求分析
      5. 设计评审
     回复 /switch <编号> 或 /join <编号> 切换目录
```

---

## /switch — Switch Active Session / 切换当前会话

切换到指定会话（跨目录支持）。可通过全局编号或 session ID 前缀查找。

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
Bot: ✅ 已切换到会话: Bug修复 (ses_xxxx…)

# 按 ID 前缀切换
用户: /switch ses_abc
Bot: ✅ 已切换到会话: 功能开发 (ses_abc123…)
```

---

## /unbind — Unbind Session / 解绑会话

解绑当前微信与 OC 会话的绑定。解绑后后续消息将创建新会话，旧会话保留在 OC 中不受影响。

**Syntax:**
```
/unbind
/解绑
```

**Alias (no space):** `/unbind0`

**Example:**
```
用户: /unbind
Bot: ✅ 已解绑，后续消息将创建新会话
```

---

## /rename — Rename Session / 修改会话标题

修改当前绑定会话的标题。标题会自动恢复微信图标前缀。

**Syntax:**
```
/rename <new title>
/改名 <新标题>
```

**Example:**
```
用户: /rename 项目讨论
Bot: ✅ 已重命名: 项目讨论
```

**Notes:**
- 修改后 Bot 自动补上 📱 前缀
- 该标题在 OC 侧可见

---

## /mode — Read Session Mode / 查询会话模式

从最新一条 AI 回复中读取当前会话的 mode（`plan` 或 `build`）。**只读**，不支持通过插件切换模式。

**Syntax:**
```
/mode         查看当前模式
/模式
```

**Example:**
```
用户: /mode
Bot: 当前模式: plan
```

**Note:** 只读不写。如需切换模式请在 OC 终端输入 `/mode plan` 或 `/mode build`。

> **原因：** OC 没有服务端 API 可以切换 session mode，`/mode` 是客户端的 slash 命令，只能在 TUI 里输入。详见 `改造计划.md` 附录 A。

---

## /help — Command List / 指令列表

显示所有可用指令。

**Syntax:**
```
/help
/帮助
```

**Example:**
```
用户: /help
Bot: 指令列表：
     /stop /停止  中断 AI 任务
     /status /状态  当前状态
     /join N /进入 N  进入目录
     ...
```

---

## Permission Approval / 权限审批

AI 需要调用工具时，会通过微信向你确认：

```
需要确认：读取文件 package.json？
回复 同意 或 拒绝
```

直接回复 `同意`（或 `yes`/`y`）即可批准，回复 `拒绝`（或 `no`/`n`）即拒绝。5 分钟无回复自动拒绝。

也支持 `/confirm <code>` 和 `/deny <code>` 的原始指令格式（code 不指定时自动匹配最新的待审批请求）。

---

## Message Flow / 消息流程

### Direct Chat / 直接对话（最简路径）

```
用户发送普通文本 → Bot 收到 → 创建/复用 OC 会话 → AI 回复 → 回复发回微信
```

1. 用户发 `你好`
2. Bot 创建会话 `📱微信-xxx`
3. AI 处理后回复 → Bot 转发到微信
4. 之后的消息复用该会话

### Multi-directory / 多目录操作

```
用户: /sessions           → 查看所有目录的会话
用户: /join 2             → 进入第 2 个项目目录
用户: /sessions           → 只看该目录的会话
用户: /bind 3             → 绑定第 3 个会话
用户: /new                → 在该目录创建新会话
用户: /switch 5           → 切换到任意目录的会话（全局编号）
```

### Permission Approval / 权限审批

```
AI 请求使用工具 → Bot 发微信通知 [#审批码]
用户: /confirm 3A8F       → AI 继续执行
用户: /deny 3A8F          → AI 放弃执行（5 分钟超时自动拒绝）
```

---

## Notes / 注意事项

| 特性 | 说明 |
|------|------|
| **会话持久化** | `wechatSid` 映射保存在 `{worktree}/.opencode/plugins/wechat-bridge/session-map.json`，重启后恢复 |
| **目录选择超时** | `/join N` 后 5 分钟无操作自动退出目录选择状态 |
| **首次消息超时** | 首次消息指导语发出后 10 分钟未收到二次消息，视为新用户重新接待 |
| **无空格参数** | `/join2` 与 `/join 2` 等价，所有带数字参数的指令都支持 |
| **凭据位置** | 登录凭据保存在 `~/.opencode/wechat-bridge/account.json`，跨项目共享 |
| **日志文件** | `.opencode/plugins/log/wechat-bridge.log` |
