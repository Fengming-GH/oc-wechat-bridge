# Expected Output Reference

以下为根据 SDK 类型定义和插件文档推测的预期输出，实测后对照修正。

## 1. client keys

```json
["session", "app", "event", "tui", "ui"]
```

实际是否有 `tui` / `ui` 待确认。

## 2. client.session keys

```json
["list", "create", "update", "prompt", "messages", "abort"]
```

是否有 `delete` / `permissionResponse` 待确认。

## 3. client.session.list() result

预期格式（参考三个参考插件）：

```json
{"type":"object","isArray":false,"keys":["data"]}
```

或直接是数组：

```json
{"type":"object","isArray":true}
```

## 4. Session 对象 keys

```json
["id", "title", "parentID", "createdAt", "updatedAt"]
```

实测后补充。

## 5. Event: session.created

```json
{
  "type": "session.created",
  "properties": {
    "info": {
      "id": "abc123...",
      "title": "新会话",
      "parentID": null
    }
  },
  "propertyKeys": ["info"]
}
```

## 6. Event: session.idle

```
>>> EVENT: session.idle
{
  "type": "session.idle",
  "properties": {
    "sessionID": "abc123..."
  },
  "propertyKeys": ["sessionID"]
}
```

## 7. Event: message.part.updated

```
>>> EVENT: message.part.updated
{
  "type": "message.part.updated",
  "properties": {
    "part": { "id": "...", "sessionID": "...", "type": "text", "text": "...", "ignored": false },
    "delta": "..."
  },
  "propertyKeys": ["part", "delta"]
}
```

## 8. Event: session.compacted

```
>>> EVENT: session.compacted
{
  "type": "session.compacted",
  "properties": {
    "sessionID": "abc123..."
  },
  "propertyKeys": ["sessionID"]
}
```

## 9. permission.ask 超时

日志中应出现类似：

```
=== permission.ask fired ===
input keys: ["id","type","sessionID","messageID","callID","title","metadata","time"]
permission auto-denied after 120s timeout
```

或：

```
permission auto-denied after 300s timeout
```

取决于 OC 的外部超时限制。记录实际值。

## 10. AbortController 测试

```
=== AbortController test: created, will abort in 5s ===
=== AbortController test: aborted ===
=== AbortController test: fetch error: The operation was aborted
aborted.name: AbortError
aborted ===> AbortError 正常
```

## 11. stdout 测试

```
[ApiScout] console.log -> 你在界面上看到这行了吗？
[ApiScout] process.stdout.write -> 你在界面上看到这行了吗？
```

如果在 GUI 界面上看不到以上两行，说明 stdout 在 GUI OC 中不可见。
