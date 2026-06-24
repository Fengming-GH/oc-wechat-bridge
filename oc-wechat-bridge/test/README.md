# API Scout — OC 插件 API 探测工具

## 安装

```bash
# 从 oc-wechat-bridge 项目根目录
npm link .\test
```

## 加载

编辑 `opencode.json`，同时加载 bridge 和 scout：

```json
{
  "plugin": [
    "@fengming-gh/oc-wechat-bridge",
    "@fengming-gh/oc-wechat-bridge-scout"
  ]
}
```

启动 OC，scout 会自动跟随 bridge 加载，不干扰正常运作。

## 测试操作

| 操作 | 触发事件 | 确认内容 |
|------|---------|---------|
| 启动 OC | — | client keys, session.keys, list/messages 结构 |
| `/new` | session.created | info 字段结构 |
| 发一条消息 | message.updated + .part.updated | part 和 delta 结构 |
| 等 AI 回复完 | session.idle | messages() 返回结构 |
| 说"执行 ls" | permission.ask | 阻塞时间 → 自动拒绝耗时 |
| 说"用 scout-abort 工具" | — | AbortError 是否正常 |
| 说"用 scout-stdout 工具" | — | stdout 是否可见 |

## 日志

```bash
type test\test-output.log
```
