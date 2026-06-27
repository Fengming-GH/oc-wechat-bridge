# PLAN: 微信审批系统（SSE 方案）

> 通过 v1 SDK `client.global.event()` SSE 流实现微信端 OC 权限审批。
> 关联：`~/.opencode/plugins/wechat-bridge.ts`

---

## 1. 目标

让 OC Desktop 用户通过微信授权/拒绝 OC 的权限请求（如 AI 想读文件、执行命令）。

**当前问题**：`permission.ask` hook 在 OC Desktop 上不触发（实测验证）。`client.global.event()` SSE 订阅是更可靠的异步事件通道。

**方案**：插件启动后订阅 `client.global.event()` SSE 流，捕获 `permission.asked` 事件 → 发微信通知用户 → 用户回复 → `client.postSessionIdPermissionsPermissionId()` 回复审批结果。

**零依赖**：全部使用 v1 `client` 对象上已有的方法，无新增 import，无 `package.json` 依赖。

---

## 2. SSE 事件实测结论

### 收到的 SSE 事件类型

| 事件类型 | 状态 | 说明 |
|---------|------|------|
| `permission.asked` | ✅ 正常工作 | 通过 `client.postSessionIdPermissionsPermissionId()` 回复 |
| `permission.v2.asked` | ❓ 未实测 | 结构同 v2，暂未出现 |
| `question.asked` | ✅ 可接收 | **回复被阻塞**——v1 SDK 无 question API，需 `@opencode-ai/sdk/v2` |

### `permission.asked` 的实际情况

OC 发送的 `permission` 字段**全是 `external_directory`**，不区分类似 `write`/`read`/`command` 等传统分类。  
**根因**：OC 按资源路径（项目内 vs 外部）划分权限，不对具体操作（读、写、执行）细分。

| 用户操作 | OC 发的 `permission` | 实际含义 |
|---------|---------------------|---------|
| Z 盘写文件 | `external_directory` | 访问外部目录 |
| Z 盘读文件 | `external_directory` | 访问外部目录 |
| Z 盘创建文件夹 | `external_directory` | 访问外部目录 |
| 读日志（`Get-Content`） | `external_directory` | 访问外部目录 |

### `metadata` 字段区分具体操作

OC 通过 `metadata` 传递操作详情：

| metadata 字段 | 示例 | 说明 |
|-------------|------|------|
| `command` | `"New-Item -ItemType Directory..."` | Shell 命令（创建目录、Get-Content 等） |
| `filepath` | `"Z:\\...\\test.txt"` | 文件操作（读/写文件） |
| `parentDir` | `"Z:\\...\\test"` | 父目录 |
| `tool` | 可能的值 | 工具名（暂未在测试中观察到） |

**结论：`permission` 字段只有 `external_directory` 一种值（针对外部目录）**，7 种翻译表（write/read/command/bash/grep/glob/task）用不上。`metadata` 才是区分具体操作的依据。

### `question.asked` 被阻塞

`question.asked` 事件可接收，结构明确：

```json
{
  "type": "question.asked",
  "properties": {
    "id": "que_xxx",
    "sessionID": "ses_xxx",
    "questions": [{
      "question": "这是在测试 question",
      "header": "测试问题",
      "options": [
        {"label": "选项A", "description": "测试选项A"},
        {"label": "选项B", "description": "测试选项B"}
      ]
    }]
  }
}
```

**v1 SDK 没有任何 question 相关 API**，无法回复。需要 `import("@opencode-ai/sdk/v2")` 调用 `v2.question.reply()`。**暂不实现**。

---

## 3. 架构

### 核心数据结构

```ts
const _pendingPerms = new Map<string, {
  timer: ReturnType<typeof setTimeout>
  sessionID: string
  permissionID: string
  wxId: string
  code: string
}>()
let _permCounter = 0
```

### 组件协作

```
client.global.event()       handleCommand (微信入口)        client.postSessionId…
┌────────────────┐         ┌──────────────────────┐      ┌──────────────────────┐
│ SSE 全局事件流   │         │ 微信用户发送           │      │ PermissionsPermission│
│                 │         │ "/同意"               │      │ Id                   │
│ permission.asked├────────►│                      │      │ → respond("once")   │
│ 事件到达         │         │ _pendingPerms 里找到  │─────►│ 放行                 │
│ 发微信 + 设置    │         │ replyPerm("once")    │      │                      │
│ 5min超时         │         │ 发微信: "✅ 已授权"    │      │                      │
└────────────────┘         └──────────────────────┘      └──────────────────────┘
```

### 关键设计决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | **使用 `client.global.event()`** | 零依赖，v1 client 已有此方法 |
| 2 | **`createPermissionHandler` 退回 `"ask"`** | OC 自身 UI 兜底，SSE 是增强 |
| 3 | **5min 超时自动拒绝** | 避免审批永久挂起 |
| 4 | **只监听到的权限类型（`external_directory`）** | 其他类型 OC 不通过 SSE 发送 |
| 5 | **去重已禁用** | 测试阶段需要观察多实例行为。后续需恢复 `_seenPermissionIds` |
| 6 | **`question.asked` 暂不处理** | v1 无 API，需 v2 SDK |

---

## 4. 审批消息格式

### permission.asked 消息

```
⚠️ 授权审批 ⚠️
访问外部目录
操作: Get-Content file.log
路径: \\nas.cn\...\*
拒绝回复：/拒绝
同意回复：/同意 1 或 /好
（5分钟后自动拒绝）
```

- `操作:` 行从 `metadata.command` 或 `metadata.filepath` 提取（最多 80 字符）
- `路径:` 行来自 `metadata.patterns`
- 无多余英文类型名，直接使用中文

### 超时消息

```
⏰ 授权超时
访问外部目录
操作: Get-Content file.log
路径: \\nas.cn\...\*
已自动拒绝
```

---

## 5. 实现细节

### `tryStartPermissionSse()`

订阅 `client.global.event()` SSE 流，循环处理事件。

```
for await (const raw of stream):
  type = raw.payload.type
  props = raw.payload.properties

  type === "permission.asked" || "permission.v2.asked":
    → 记录日志 (SSE_PERM)
    → 检查 wxId (findWechatSender)
    → 生成 code (递增计数器)
    → 构造消息 (metadata.command/filepath → 操作行)
    → sendText 发微信
    → 设置 5min 超时
    → 存入 _pendingPerms

  type === "question.asked":
    → 仅日志记录 (SSE_RAW)
    → 不处理

  其他类型: continue
```

### `handleCommand` 审批匹配

在 `handleCommand` 中，`switch(command)` 前插入：

```
同意词表匹配 → replyPerm("once") → 发微信 "✅ 已授权"
拒绝词表匹配 → replyPerm("reject") → 发微信 "❌ 已拒绝"
同意/拒绝 + 验证码 → 只操作单个 pending
```

`replyPerm` 调用 `client.postSessionIdPermissionsPermissionId()`。  
⚠️ 路径参数是 `id` 不是 `sessionID`！

### 验证码

- 递增计数器：`1, 2, 3, ...`
- `_pendingPerms` 清空时归 0
- 始终一位数，永不冲突

---

## 6. 词表

所有词需带 `/` 前缀。不区分大小写。

**同意词表（13 个）**：
```
/同意, /好, /好的, /ok, /yes, /确认, /批准, /是, /可以, /行, /对, /嗯, /y
```

**拒绝词表（11 个）**：
```
/拒绝, /no, /不了, /不, /不行, /不可以, /否, /取消, /不要, /n
```

---

## 7. 风险与缓解

| 风险 | 场景 | 缓解方案 |
|------|------|---------|
| **多实例重复消息** | OC 加载 3 个插件实例，同时收到同一 SSE 事件 | `_seenPermissionIds` 模块级变量即时代重 ✅ |
| **SSE 断连** | 网络波动 | `while(true)` + 3s 重连 |
| **`question.asked` 无法回复** | v1 SDK 无 question API | 已确认阻塞，暂不处理 |
| **超时** | 用户没看手机 | 5 分钟自动 reject |
| **`metadata` 字段为空** | 部分操作可能不附带 context | 简单跳过 `操作:` 行 |

---

## 8. 待处理项

| 优先级 | 事项 | 说明 |
|--------|------|------|
| 高 | 恢复 `_seenPermissionIds` 去重 | 当前已禁用，每事件 ×3 发微信 |
| 低 | `question.asked` 回复 | v1 无 API，需 `@opencode-ai/sdk/v2`。暂不实现 |
| 低 | 清理多实例问题 | 需排查 OC 为何加载 3 个相同插件 |

---

## 9. 代码规模

| 模块 | 行数 |
|------|------|
| `_pendingPerms` + `_permCounter` | ~8 |
| `tryStartPermissionSse(client)` | ~40 |
| `createPermissionHandler` 退回 | ~3 |
| `handleCommand` 审批匹配 | ~35 |
| 插件入口调用 | ~1 |
| **净增** | **~50 行** |
