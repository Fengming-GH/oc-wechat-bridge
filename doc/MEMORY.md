# Session Memory

## 当前状态（2026-06-29）

- 微信审批系统已定稿，使用 `\n\n` 换行符
- `permission.ask` hook 已删除，仅使用 SSE 通道
- `replyPerm` 改为 async，先 await API 再删 pending
- 验证码使用递增计数器，pending 清空时归 0
- `_seenPermissionIds` 多实例去重已恢复

## 待处理

- [ ] 将全局改动同步到 `oc-wechat-bridge/src/index.ts`
- [ ] 同步 BAK 后 git commit
- [ ] 推送到 GitHub + npm publish

## 已知问题

- `question.asked` 事件可接收，但 v1 SDK 无 question API，回复被阻塞
- 审批消息单 `\n` 在 WeChat 短消息中不生效，必须用 `\n\n`
