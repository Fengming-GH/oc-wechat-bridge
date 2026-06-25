// ============================================================
// oc-wechat-bridge: 将微信消息桥接到 OpenCode
// 单文件插件，零运行时依赖
// ============================================================

// ============================================================
// Section 1:  Imports
// ============================================================

import type { Plugin } from "@opencode-ai/plugin"
import type {
  EventSessionIdle,
  EventSessionCreated,
  EventSessionDeleted,
  EventSessionUpdated,
  Session,
} from "@opencode-ai/sdk"

import { tool } from "@opencode-ai/plugin"

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto"
import {
  appendFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { resolve, dirname, join, basename } from "node:path"
import { fileURLToPath } from "node:url"

// ============================================================
// Section 2:  Constants & Files
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = resolve(__dirname, "log", "wechat-bridge.log")
const PROJECT_ROOT = resolve(__dirname, "..", "..")

const HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? "."
const OLD_DATA_DIR = join(HOME_DIR, ".cli-bridge")
const DATA_DIR = process.env.WECHAT_BRIDGE_DATA_DIR?.trim()
  ?? join(HOME_DIR, ".opencode", "wechat-bridge")
const CREDENTIALS_FILE = join(DATA_DIR, "account.json")
const SYNC_BUF_FILE = join(DATA_DIR, "sync_buf.txt")
const CONTEXT_TOKENS_FILE = join(DATA_DIR, "context_tokens.json")
const ATTACHMENTS_DIR = join(DATA_DIR, "inbound-attachments")

const BASE_URL = process.env.WECHAT_ILINK_BASE_URL?.trim()
  ?? "https://ilinkai.weixin.qq.com"
const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
const CHANNEL_VERSION = "0.3.0"
const LONG_POLL_TIMEOUT_MS = 35_000
const SEND_TIMEOUT_MS = 15_000
const CDN_DOWNLOAD_TIMEOUT_MS = 30_000
const CDN_MAX_RETRIES = 3

const SESSION_MAP_REL_DIR = join(".opencode", "plugins", "wechat-bridge")
const SESSION_MAP_FILE = "session-map.json"

const MAX_IMAGE_MB = Number(process.env.WECHAT_MAX_IMAGE_MB) || 20
const MAX_FILE_MB = Number(process.env.WECHAT_MAX_FILE_MB) || 50
const MAX_INBOUND_IMAGE_MB = Number(process.env.WECHAT_MAX_INBOUND_IMAGE_MB) || 20
const MAX_INBOUND_FILE_MB = Number(process.env.WECHAT_MAX_INBOUND_FILE_MB) || 50
const BYTES_PER_MB = 1024 * 1024

const RECENT_KEYS_MAX = 500

const MSG_TYPE_USER = 1
const MSG_TYPE_BOT = 2
const MSG_ITEM_TEXT = 1
const MSG_ITEM_IMAGE = 2
const MSG_ITEM_VOICE = 3
const MSG_ITEM_FILE = 4
const MSG_ITEM_VIDEO = 5
const MSG_STATE_FINISH = 2
const UPLOAD_MEDIA_TYPE_IMAGE = 1
const UPLOAD_MEDIA_TYPE_FILE = 3

const DEBUG = process.env.WECHAT_OPENCODE_DEBUG?.trim() === "1"

let syncBuffer = ""
const contextTokens = new Map<string, string>()
const recentMessageKeys = new Set<string>()
const recentMessageOrder: string[] = []
const sidTitle = new Map<string, string>()
const wechatSid = new Map<string, string>()
const _pendingFirstContact = new Set<string>()
let _projectDirs: string[] = []
const _modeCache = new Map<string, string>()
const _pendingPermByWx = new Map<string, { sessionID: string; permissionID: string }>()
const _thinkingSent = new Set<string>()
const _fwdLastTool = new Map<string, string>()
const _userMsgIds = new Set<string>()
const _fwdQueue = new Map<string, Promise<void>>()
const _pendingContinue = new Set<string>()
const _skipMsgIds = new Set<string>()

function enqueueSend(sid: string, fn: () => Promise<void>) {
  const prev = _fwdQueue.get(sid) ?? Promise.resolve()
  _fwdQueue.set(sid, prev.then(() => fn(), () => fn()))
}

// ============================================================
// Section 3:  Utility Helpers
// ============================================================

function bjNow(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(new Date()).replace(/\//g, "-")
}

function log(level: string, msg: string) {
  try {
    appendFileSync(LOG_PATH, `${bjNow()} [${level}] ${msg}\n`, "utf-8")
  } catch { /* best effort */ }
}

function t(sid: string): string {
  return sidTitle.get(sid) ?? "?" + sid.slice(0, 8)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ============================================================
// Section 4:  Crypto Helpers (AES-128-ECB)
// ============================================================

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), "utf-8").toString("base64")
}

function decodeInboundMediaAesKey(value: string): Buffer {
  const trimmed = value.trim()
  if (/^[a-f0-9]{32}$/i.test(trimmed)) return Buffer.from(trimmed, "hex")
  const decoded = Buffer.from(trimmed, "base64")
  if (decoded.length === 16) return decoded
  const decodedText = decoded.toString("utf8").trim()
  if (/^[a-f0-9]{32}$/i.test(decodedText)) return Buffer.from(decodedText, "hex")
  throw new Error("Unsupported inbound media aes key format: " + value.slice(0, 20))
}

function decryptInboundMediaPayload(ciphertext: Buffer, aesKey: string): Buffer {
  return decryptAesEcb(ciphertext, decodeInboundMediaAesKey(aesKey))
}

function encodeMessageAesKey(aesKey: Buffer): string {
  return Buffer.from(aesKey.toString("hex")).toString("base64")
}

function buildCdnDownloadUrl(encryptQueryParam: string): string {
  return `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`
}

function buildCdnUploadUrl(uploadParam: string, filekey: string): string {
  return `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}

// ============================================================
// Section 5:  Session Cache
// ============================================================

function initSessionCache(client: any) {
  setTimeout(async () => {
    try {
      const resp: any = await client.session.list()
      const all: Session[] = Array.isArray(resp) ? resp : resp.data ?? []
      for (const s of all) {
        if (!s.parentID) sidTitle.set(s.id, s.title)
      }
      log("INIT", `cached ${sidTitle.size} sessions`)
    } catch (err) {
      log("INIT_FAIL", `${err}`)
    }
  }, 0)
}

const WECHAT_ICON = "📱"
const WECHAT_ICON_DEGRADED = "📵"
const WECHAT_ICON_PROCESSING = "💬"
const WECHAT_ICON_OFFLINE = "🔴"
const ICON_PREFIXES = [WECHAT_ICON, WECHAT_ICON_DEGRADED, WECHAT_ICON_PROCESSING, WECHAT_ICON_OFFLINE]

function wechatTitle(): string {
  const d = new Date()
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d)
  const m = new Map(parts.map(p => [p.type, p.value]))
  return `微信-${m.get("year")}-${m.get("month")}-${m.get("day")}/${m.get("hour")}-${m.get("minute")}`
}

function stripIconPrefix(title: string): string {
  for (const p of ICON_PREFIXES) {
    if (title.startsWith(p)) return title.slice(p.length)
  }
  return title
}

async function updateSessionIcon(client: any, sid: string, status: "normal" | "degraded" | "processing" | "offline") {
  try {
    let title = sidTitle.get(sid)
    if (!title) return
    const base = stripIconPrefix(title)
    const iconMap: Record<string, string> = {
      normal: WECHAT_ICON,
      degraded: WECHAT_ICON_DEGRADED,
      processing: WECHAT_ICON_PROCESSING,
      offline: WECHAT_ICON_OFFLINE,
    }
    const newTitle = iconMap[status] + base
    if (newTitle !== title) {
      await client.session.update({ path: { id: sid }, body: { title: newTitle } })
      sidTitle.set(sid, newTitle)
    }
  } catch { /* best effort */ }
}

const sendFailCount = new Map<string, number>()
const SEND_FAIL_THRESHOLD = 3

function recordSendResult(sid: string | null, success: boolean, client: any) {
  if (!sid) return
  const current = sendFailCount.get(sid) ?? 0
  if (success) {
    sendFailCount.set(sid, 0)
    updateSessionIcon(client, sid, "normal")
  } else {
    const next = current + 1
    sendFailCount.set(sid, next)
    if (next >= SEND_FAIL_THRESHOLD) {
      updateSessionIcon(client, sid, "degraded")
    }
  }
}

async function getOrCreateSession(client: any, wechatId: string, worktree: string): Promise<string> {
  const existing = wechatSid.get(wechatId)
  if (existing && sidTitle.has(existing)) {
    updateSessionIcon(client, existing, "normal")
    return existing
  }

  try {
    const title = wechatTitle()
    const resp: any = await client.session.create({
      body: { title },
    })
    const sid = resp.id ?? resp.sessionID ?? resp.data?.id
    if (sid) {
      wechatSid.set(wechatId, sid)
      sidTitle.set(sid, title)
      saveSessionMapping(worktree)
      await updateSessionIcon(client, sid, "normal")
      log("SESSION", `created [${t(sid)}] for wechat:${wechatId.slice(0, 8)}`)
      return sid
    }
  } catch (err) {
    log("SESSION_CREATE_FAIL", `${err}`)
  }

  try {
    const resp: any = await client.session.list()
    const all: Session[] = Array.isArray(resp) ? resp : resp.data ?? []
    const first = all.find((s: Session) => !s.parentID)
    if (first) {
      wechatSid.set(wechatId, first.id)
      sidTitle.set(first.id, `${WECHAT_ICON}${first.title}`)
      await updateSessionIcon(client, first.id, "normal")
      saveSessionMapping(worktree)
      return first.id
    }
  } catch { /* best effort */ }
  throw new Error("No available session")
}

function findWechatSender(sid: string): string | null {
  let fallback: string | null = null
  for (const [wx, s] of wechatSid) {
    if (s === sid) {
      if (wx.endsWith("@im.wechat")) return wx
      fallback = wx
    }
  }
  return fallback
}

function resolveWorktree(worktree: string): string {
  return (!worktree || worktree === "/" || worktree === "\\") ? PROJECT_ROOT : worktree
}

function sessionMapPath(worktree: string): string {
  return join(resolveWorktree(worktree), SESSION_MAP_REL_DIR, SESSION_MAP_FILE)
}

function loadSessionMapping(worktree: string) {
  const newFp = sessionMapPath(worktree)
  let fp = newFp
  if (!existsSync(fp)) {
    // 旧路径：worktree=/ 时 session-map 被写到了根目录
    const oldFp = join(worktree, SESSION_MAP_REL_DIR, SESSION_MAP_FILE)
    if (worktree !== resolveWorktree(worktree) && existsSync(oldFp)) {
      try {
        const dir = join(resolveWorktree(worktree), SESSION_MAP_REL_DIR)
        mkdirSync(dir, { recursive: true })
        const data = readFileSync(oldFp)
        writeFileSync(newFp, data)
        try { rmSync(oldFp) } catch { }
        log("MAP", `migrated from ${oldFp} to ${newFp}`)
        fp = newFp
      } catch (e) {
        log("MAP_MIGRATE_ERR", `${e}`)
        fp = oldFp
      }
    }
  }
  try {
    if (!existsSync(fp)) return
    const raw = JSON.parse(readFileSync(fp, "utf-8"))
    if (typeof raw !== "object" || raw === null) return
    for (const [wx, sid] of Object.entries(raw)) {
      if (typeof wx === "string" && typeof sid === "string") {
        const key = wx.replace(/@im\.wechat$/, "")
        wechatSid.set(key, sid)
        if (wx !== key) wechatSid.set(wx, sid)
      }
    }
    if (wechatSid.size > 0) {
      log("MAP", `restored ${wechatSid.size} session mappings from ${fp}`)
    }
  } catch (e) {
    log("MAP_LOAD_ERR", `${e}`)
  }
}

function saveSessionMapping(worktree: string) {
  const dir = join(resolveWorktree(worktree), SESSION_MAP_REL_DIR)
  try { mkdirSync(dir, { recursive: true }) } catch { /* ok */ }
  const fp = join(dir, SESSION_MAP_FILE)
  const tmp = fp + ".tmp"
  try {
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(wechatSid), null, 2), "utf-8")
    renameSync(tmp, fp)
  } catch (e) {
    log("MAP_WRITE_ERR", `${e}`)
  }
}

function findProjectDirs(worktree: string): string[] {
  const effective = resolveWorktree(worktree)
  const parent = resolve(effective, "..")
  const dirs: string[] = [effective]
  try {
    for (const entry of readdirSync(parent)) {
      const full = join(parent, entry)
      if (full !== effective && existsSync(join(full, ".opencode"))) {
        dirs.push(full)
      }
    }
  } catch (e) {
    log("FIND_DIRS_ERR", `worktree=${worktree} effective=${effective} parent=${parent} ${e}`)
  }
  log("FIND_DIRS", `worktree=${worktree} effective=${effective} dirs=${JSON.stringify(dirs)}`)
  return dirs
}

// ============================================================
// Section 6:  Credentials & Data Persistence
// ============================================================

function ensureDataDir() {
  try { mkdirSync(DATA_DIR, { recursive: true }) } catch { /* ok */ }
}

function migrateOldDataDir() {
  ensureDataDir()
  if (!existsSync(OLD_DATA_DIR)) return
  const oldCreds = join(OLD_DATA_DIR, "account.json")
  if (!existsSync(oldCreds)) {
    try { rmSync(OLD_DATA_DIR, { recursive: true }) } catch { }
    return
  }
  // 优先迁移旧凭据（已知能用），覆盖新位置
  log("MIGRATE", `restoring old creds from ${OLD_DATA_DIR}`)
  try {
    const files = ["account.json", "sync_buf.txt", "context_tokens.json", "wechat-login.html"]
    for (const f of files) {
      const src = join(OLD_DATA_DIR, f)
      if (existsSync(src)) renameSync(src, join(DATA_DIR, f))
    }
    const oldAtt = join(OLD_DATA_DIR, "inbound-attachments")
    if (existsSync(oldAtt)) renameSync(oldAtt, ATTACHMENTS_DIR)
    try { rmSync(OLD_DATA_DIR, { recursive: true }) } catch { }
    log("MIGRATE", `done`)
  } catch (e) {
    log("MIGRATE_ERR", `${e}`)
  }
}

function loadCredentials(): WechatCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null
    return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"))
  } catch { return null }
}

function saveCredentials(cred: WechatCredentials) {
  ensureDataDir()
  const tmp = CREDENTIALS_FILE + ".tmp"
  try {
    writeFileSync(tmp, JSON.stringify(cred, null, 2), "utf-8")
    renameSync(tmp, CREDENTIALS_FILE)
  } catch (e) {
    log("CRED_WRITE_ERR", `${e}`)
  }
}

async function validateCredentials(cred: WechatCredentials): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/ilink/bot/getupdates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        Authorization: `Bearer ${cred.token}`,
        "X-WECHAT-UIN": randomWechatUin(),
      },
      body: JSON.stringify({
        get_updates_buf: "",
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      signal: AbortSignal.timeout(5_000),
    })
    if (res.status === 401 || res.status === 403) return "Credentials rejected by server"
    const text = await res.text()
    const parsed = JSON.parse(text)
    if (parsed.errcode === -14 && /session timeout/i.test(parsed.errmsg ?? "")) {
      return "Session expired, re-login required"
    }
    return null
  } catch {
    return null
  }
}

function loadSyncBuffer(): string {
  try {
    if (!existsSync(SYNC_BUF_FILE)) return ""
    return readFileSync(SYNC_BUF_FILE, "utf-8")
  } catch { return "" }
}

function saveSyncBuffer(buf: string) {
  ensureDataDir()
  try { writeFileSync(SYNC_BUF_FILE, buf, "utf-8") } catch { /* best effort */ }
}

function saveContextTokens() {
  ensureDataDir()
  try {
    writeFileSync(CONTEXT_TOKENS_FILE, JSON.stringify(Object.fromEntries(contextTokens)), "utf-8")
  } catch { /* best effort */ }
}

function loadContextTokens() {
  try {
    if (!existsSync(CONTEXT_TOKENS_FILE)) return
    const raw = JSON.parse(readFileSync(CONTEXT_TOKENS_FILE, "utf-8"))
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") {
        const key = k.replace(/@im\.wechat$/, "")
        contextTokens.set(key, v)
        if (k !== key) contextTokens.set(k, v)
      }
    }
  } catch { /* best effort */ }
}

async function qrCodeLogin(): Promise<WechatCredentials> {
  log("LOGIN", "Starting QR code login...")

  const qrResp: any = await (
    await fetch(`${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`)
  ).json()
  const qrcode = qrResp.qrcode
  const qrContent = qrResp.qrcode_img_content
  const encodedUrl = encodeURIComponent(qrContent)

  const QR_HTML_PATH = join(DATA_DIR, "wechat-login.html")
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WeChat 扫码登录</title>
<style>
  body { display:flex; justify-content:center; align-items:center; height:100vh; margin:0; background:#f5f5f5; font-family:Arial,sans-serif; }
  .box { text-align:center; background:#fff; padding:30px; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
  img { border:2px solid #07c160; border-radius:8px; padding:10px; background:#fff; }
  p { color:#333; font-size:14px; margin-top:12px; }
</style></head>
<body>
<div class="box">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedUrl}" alt="QR Code" width="300" height="300">
  <p>请使用微信扫描上方二维码登录</p>
</div>
</body></html>`
  ensureDataDir()
  try { writeFileSync(QR_HTML_PATH, html, "utf-8") } catch { }
  log("QR", `saved to ${QR_HTML_PATH}`)
  try { const { exec } = await import("node:child_process"); exec(`start "" "${QR_HTML_PATH}"`) } catch { }

  for (let i = 0; i < 120; i++) {
    const status: any = await (
      await fetch(
        `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        { headers: { "iLink-App-ClientVersion": "1" } },
      )
    ).json()

    if (status.status === "confirmed") {
      const account: WechatCredentials = {
        token: status.bot_token,
        baseUrl: BASE_URL,
        accountId: status.ilink_bot_id,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      }
      saveCredentials(account)
      log("LOGIN", `success: ${account.accountId}`)
      return account
    }

    if (status.status === "scaned") {
      log("QR", "scanned, waiting for phone confirmation...")
    }

    await sleep(1_000)
  }

  throw new Error("QR code login timed out (2 min)")
}

interface WechatCredentials {
  token: string
  baseUrl: string
  accountId: string
  userId: string
  savedAt: string
}

// ============================================================
// Section 7:  WeChat HTTP Transport
// ============================================================

async function apiFetch(
  endpoint: string,
  body: object,
  token: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const base = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/"
  const jsonBody = JSON.stringify(body)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AuthorizationType: "ilink_bot_token",
        "X-WECHAT-UIN": randomWechatUin(),
        "Content-Length": String(Buffer.byteLength(jsonBody, "utf-8")),
        Authorization: `Bearer ${token}`,
      },
      body: jsonBody,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    if (!text.trim()) return text

    const parsed = JSON.parse(text)
    const ret = parsed.ret ?? 0
    const errcode = parsed.errcode ?? 0
    const errmsg = parsed.errmsg ?? ""

    if (ret !== 0 || errcode !== 0) {
      log("API_ERR", `${endpoint} ret=${ret} errcode=${errcode} errmsg=${errmsg}`)
      if (errcode === -14 && /session timeout/i.test(errmsg)) {
        throw new Error("WeChat session timed out")
      }
      if (ret === -2) {
        throw new Error("Context token stale")
      }
      throw new Error(`API error: ${endpoint} ret=${ret} errcode=${errcode}`)
    }
    return text
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function getUpdates(account: WechatCredentials, timeoutMs: number, signal?: AbortSignal): Promise<{
  msgs: any[]
  get_updates_buf: string | null
}> {
  const raw = await apiFetch(
    "ilink/bot/getupdates",
    { get_updates_buf: syncBuffer, base_info: { channel_version: CHANNEL_VERSION } },
    account.token,
    timeoutMs,
    signal,
  )
  if (!raw.trim()) return { msgs: [], get_updates_buf: null }
  const parsed = JSON.parse(raw)
  const newBuf = parsed.get_updates_buf ?? null
  if (newBuf) {
    syncBuffer = newBuf
    saveSyncBuffer(syncBuffer)
  }
  return {
    msgs: parsed.msgs ?? [],
    get_updates_buf: newBuf,
  }
}

function findSidByRecipient(recipientId: string): string | null {
  for (const [wx, sid] of wechatSid) {
    if (wx === recipientId) return sid
  }
  return null
}

async function sendText(
  account: WechatCredentials,
  recipientId: string,
  text: string,
  contextToken?: string,
  client?: any,
) {
  const trimmed = text.trim()
  if (!trimmed) return

  let token = contextToken
  if (!token) token = contextTokens.get(recipientId)
  if (!token) {
    log("SEND_SKIP", `no context token for ${recipientId.slice(0, 16)}`)
    return
  }

  try {
    await apiFetch(
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: recipientId,
          client_id: `wechat-bridge:${Date.now()}-${randomBytes(4).toString("hex")}`,
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [{ type: MSG_ITEM_TEXT, text_item: { text: trimmed } }],
          context_token: token,
        },
        base_info: { channel_version: CHANNEL_VERSION },
      },
      account.token,
      SEND_TIMEOUT_MS,
    )
    if (client) recordSendResult(findSidByRecipient(recipientId), true, client)
  } catch (err: any) {
    if (err.message?.includes("Context token stale")) {
      log("SEND_STALE", `drop msg for ${recipientId.slice(0, 16)}`)
      return
    }
    if (client) recordSendResult(findSidByRecipient(recipientId), false, client)
    throw err
  }
}

async function sendImage(
  account: WechatCredentials,
  recipientId: string,
  imagePath: string,
  client?: any,
) {
  try {
    const upload = await uploadToCdn(account, imagePath, UPLOAD_MEDIA_TYPE_IMAGE, recipientId)
    await apiFetch(
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: recipientId,
          client_id: `wechat-bridge:${Date.now()}-${randomBytes(4).toString("hex")}`,
          message_type: MSG_TYPE_BOT,
          message_state: MSG_STATE_FINISH,
          item_list: [{
            type: MSG_ITEM_IMAGE,
            image_item: {
              media: {
                encrypt_query_param: upload.downloadParam,
                aes_key: encodeMessageAesKey(upload.aesKey),
                encrypt_type: 1,
              },
              mid_size: upload.filesize,
            },
          }],
          context_token: contextTokens.get(recipientId) ?? "",
        },
        base_info: { channel_version: CHANNEL_VERSION },
      },
      account.token,
      SEND_TIMEOUT_MS,
    )
    if (client) recordSendResult(findSidByRecipient(recipientId), true, client)
  } catch (err) {
    if (client) recordSendResult(findSidByRecipient(recipientId), false, client)
    throw err
  }
}

// ============================================================
// Section 8:  CDN Upload / Download
// ============================================================

async function uploadToCdn(
  account: WechatCredentials,
  filePath: string,
  mediaType: number,
  recipientId: string,
): Promise<{ downloadParam: string; aesKey: Buffer; filesize: number }> {
  const fileBuf = readFileSync(filePath)
  const rawsize = fileBuf.length
  const rawfilemd5 = createHash("md5").update(fileBuf).digest("hex")
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = randomBytes(16).toString("hex")
  const aesKey = randomBytes(16)

  const uploadResp = JSON.parse(await apiFetch(
    "ilink/bot/getuploadurl",
    {
      filekey,
      media_type: mediaType,
      to_user_id: recipientId,
      rawsize,
      rawfilemd5,
      filesize,
      aeskey: aesKey.toString("hex"),
      no_need_thumb: true,
      base_info: { channel_version: CHANNEL_VERSION },
    },
    account.token,
    SEND_TIMEOUT_MS,
  ))

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl returned no upload_param")
  }

  const ciphertext = encryptAesEcb(fileBuf, aesKey)
  const cdnUrl = buildCdnUploadUrl(uploadResp.upload_param, filekey)

  for (let attempt = 1; attempt <= CDN_MAX_RETRIES; attempt++) {
    try {
      const cdnRes = await fetch(cdnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      })
      if (cdnRes.status >= 400 && cdnRes.status < 500) {
        const errMsg = cdnRes.headers.get("x-error-message") ?? (await cdnRes.text())
        throw new Error(`CDN client error ${cdnRes.status}: ${errMsg}`)
      }
      if (cdnRes.status !== 200) {
        const errMsg = cdnRes.headers.get("x-error-message") ?? `status ${cdnRes.status}`
        throw new Error(`CDN server error: ${errMsg}`)
      }
      const downloadParam = cdnRes.headers.get("x-encrypted-param")
      if (!downloadParam) throw new Error("CDN response missing x-encrypted-param")
      return { downloadParam, aesKey, filesize }
    } catch (err: any) {
      if (err.message?.includes("client error")) throw err
      if (attempt >= CDN_MAX_RETRIES) throw err
      log("CDN_UPLOAD_RETRY", `attempt ${attempt}: ${err.message}`)
    }
  }

  throw new Error("CDN upload failed after retries")
}

async function downloadFromCdn(media: {
  encrypt_query_param?: string
  full_url?: string
  aes_key?: string
}): Promise<Buffer> {
  let cdnUrl: string
  if (media.full_url?.trim()) {
    cdnUrl = media.full_url.trim()
  } else if (media.encrypt_query_param?.trim()) {
    cdnUrl = buildCdnDownloadUrl(media.encrypt_query_param.trim())
  } else {
    throw new Error("Inbound media missing both full_url and encrypt_query_param")
  }

  for (let attempt = 1; attempt <= CDN_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        signal: AbortSignal.timeout(CDN_DOWNLOAD_TIMEOUT_MS),
      })
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get("x-error-message") ?? (await res.text())
        throw new Error(`CDN client error ${res.status}: ${errMsg}`)
      }
      if (res.status !== 200) throw new Error(`CDN download status ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err: any) {
      if (err.message?.includes("client error")) throw err
      if (attempt >= CDN_MAX_RETRIES) throw err
      log("CDN_DOWNLOAD_RETRY", `attempt ${attempt}: ${err.message}`)
    }
  }

  throw new Error("CDN download failed after retries")
}

// ============================================================
// Section 9:  Long Polling Loop
// ============================================================

function startPollingLoop(
  account: WechatCredentials,
  client: any,
  signal: AbortSignal,
  worktree: string,
) {
  let backoff = 1_000

  ;(async () => {
    syncBuffer = loadSyncBuffer()
    loadContextTokens()

    log("POLL", "polling loop started")

    while (!signal.aborted) {
      try {
        const { msgs } = await getUpdates(account, LONG_POLL_TIMEOUT_MS, signal)
        backoff = 1_000
        sendFailCount.clear()

        for (const raw of msgs) {
          await processInboundMessage(raw, account, client, worktree)
        }
      } catch (err: any) {
        if (signal.aborted) break

        if (err.name === "AbortError") continue

        if (err.message?.includes("session timed out")) {
          log("POLL_FATAL", err.message)
          try {
            await sendText(account, account.userId, "微信登录已过期，请在终端重新扫码登录")
          } catch { /* best effort */ }
          break
        }

        if (err.message?.includes("Context token stale")) {
          log("POLL", "context_token stale, clearing all cached tokens")
          contextTokens.clear()
          saveContextTokens()
          continue
        }

        log("POLL_RETRY", `${err.message}, backoff=${backoff}ms`)
        await sleep(Math.min(backoff, 30_000))
        backoff *= 2
      }
    }

    log("POLL", "polling loop ended")
  })()

  signal.addEventListener("abort", () => {
    log("INFO", "plugin shutting down, polling stopped")
  }, { once: true })
}

// ============================================================
// Section 10:  WeChat Message Handling
// ============================================================

async function processInboundMessage(
  raw: any,
  account: WechatCredentials,
  client: any,
  worktree: string,
) {
  if (raw.message_type !== MSG_TYPE_USER) return

  const { text, attachments } = extractInboundContent(raw)

  if (!text && attachments.length === 0) return

  const msgKey = [
    raw.from_user_id ?? "",
    raw.client_id ?? "",
    String(raw.create_time_ms ?? ""),
    raw.context_token ?? "",
  ].join("|")
  if (recentMessageKeys.has(msgKey)) return
  recentMessageKeys.add(msgKey)
  recentMessageOrder.push(msgKey)
  while (recentMessageOrder.length > RECENT_KEYS_MAX) {
    const oldest = recentMessageOrder.shift()!
    recentMessageKeys.delete(oldest)
  }

  const senderId = raw.from_user_id ?? "unknown"
  const sender = senderId.split("@")[0] || senderId

  if (raw.context_token) {
    contextTokens.set(senderId, raw.context_token)
    if (contextTokens.size > 500) contextTokens.clear()
    saveContextTokens()
  }

  const downloadedPaths: string[] = []
  for (const att of attachments) {
    try {
      const encrypted = await downloadFromCdn(att.media)
      const plaintext = decryptInboundMediaPayload(encrypted, att.aesKey)
      const filePath = saveAttachment(att.fileName || `wechat-${att.kind}`, plaintext)
      downloadedPaths.push(filePath)
      log("ATTACH_DL", `${att.kind}: ${filePath}`)
    } catch (err: any) {
      log("ATTACH_DL_FAIL", `${att.kind}: ${err.message}`)
    }
  }

  const trimmed = text.trim()
  if (trimmed.startsWith("/")) {
    await handleCommand(trimmed, senderId, account, client, worktree)
    return
  }

  if (!wechatSid.has(senderId)) {
    if (await handleFirstContact(text, senderId, account, client, worktree)) return
  }

  // 同意/拒绝 → 审批
  const approve = trimmed === "同意" || trimmed === "yes" || trimmed === "y"
  const reject = trimmed === "拒绝" || trimmed === "no" || trimmed === "n"
  if (approve || reject) {
    const perm = _pendingPermByWx.get(senderId)
    if (perm) {
      _pendingPermByWx.delete(senderId)
      try {
        await client.postSessionIdPermissionsPermissionId({
          path: { id: perm.sessionID, permissionID: perm.permissionID },
          body: { response: approve ? "once" : "reject" },
        })
        await sendText(account, senderId, approve ? "✅ 已批准" : "✅ 已拒绝", undefined, client)
      } catch {
        await sendText(account, senderId, "审批失败", undefined, client)
      }
    } else {
      await sendText(account, senderId, "当前没有待审批的请求", undefined, client)
    }
    return
  }

  log("WX_IN_RAW", `text=${JSON.stringify(trimmed.slice(0, 120))}`)
  log("WX_IN", `[${sender}] ${trimmed.slice(0, 80)}`)
  try {
    const sid = await getOrCreateSession(client, senderId, worktree)
    const prompt = downloadedPaths.length > 0
      ? `${trimmed}\n\n[收到文件] ${downloadedPaths.join(", ")}`
      : trimmed

    await updateSessionIcon(client, sid, "processing")
    await client.session.promptAsync({
      path: { id: sid },
      body: { agent: "build", parts: [{ type: "text" as any, text: prompt }] },
    })
    log("INJECT", `[${t(sid)}] ← ${trimmed.slice(0, 60)}`)
  } catch (err: any) {
    log("INJECT_FAIL", `${err.message}`)
    try {
      await sendText(account, senderId, "消息已收到，但注入会话失败，请稍后重试", undefined, client)
    } catch { /* best effort */ }
  }
}

function extractInboundContent(raw: any): {
  text: string
  attachments: Array<{ kind: string; fileName: string; media: any; aesKey: string }>
} {
  const lines: string[] = []
  const attachments: Array<{ kind: string; fileName: string; media: any; aesKey: string }> = []

  for (const item of raw.item_list ?? []) {
    if (item.ref_msg) {
      const refParts: string[] = []
      if (item.ref_msg.title?.trim()) refParts.push(item.ref_msg.title.trim())
      if (item.ref_msg.message_item?.text_item?.text?.trim()) {
        refParts.push(item.ref_msg.message_item.text_item.text.trim())
      }
      if (refParts.length) lines.push(`引用: ${refParts.join(" | ")}`)
    }

    if (item.type === MSG_ITEM_TEXT) {
      const t = item.text_item?.text?.trim()
      if (t) lines.push(t)
    }

    if (item.type === MSG_ITEM_VOICE) {
      const transcript = item.voice_item?.text?.trim()
      if (transcript) lines.push(transcript)
    }

    if (item.type === MSG_ITEM_IMAGE) {
      const media = item.image_item?.media
      const aesKey = media?.aes_key ?? media?.aeskey ?? item.image_item?.aes_key ?? item.image_item?.aeskey
      if (media && aesKey?.trim()) {
        attachments.push({
          kind: "image",
          fileName: item.image_item?.file_name?.trim() || "wechat-image.jpg",
          media,
          aesKey,
        })
      } else {
        lines.push("[微信图片: 无法下载]")
      }
    }

    if (item.type === MSG_ITEM_FILE) {
      const media = item.file_item?.media
      const aesKey = media?.aes_key ?? media?.aeskey ?? item.file_item?.aes_key ?? item.file_item?.aeskey
      if (media && aesKey?.trim()) {
        attachments.push({
          kind: "file",
          fileName: item.file_item?.file_name?.trim() || "wechat-file",
          media,
          aesKey,
        })
      } else {
        lines.push("[微信文件: 无法下载]")
      }
    }
  }

  return { text: lines.join("\n").trim(), attachments }
}

function saveAttachment(fileName: string, data: Buffer): string {
  const today = new Date().toISOString().slice(0, 10)
  const dir = join(ATTACHMENTS_DIR, today)
  mkdirSync(dir, { recursive: true })
  const safeName = fileName
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
  const uniqueName = `${today}-${randomBytes(4).toString("hex")}-${safeName}`
  const fp = join(dir, uniqueName)
  writeFileSync(fp, data)
  return fp
}

// ============================================================
// Section 10b:  WeChat Command Handler
// ============================================================

/**
 * 指令中英双语对照表
 * | 指令 | 别名 | 功能 |
 * |:-----|:-----|:-----|
 * | `/stop` | `/停止` | 中断当前 AI 任务 |
 * | `/status` | `/状态` | 查看所有目录和会话 |
 * | `/switch <id\|编号>` | `/切换 <id\|编号>` | 切换到指定会话 |
 * | `/new [N]` | `/新建 [N]` | 创建新会话（支持指定目录） |
 * | `/unbind` | `/解绑` | 解绑当前会话 |
 * | `/rename <标题>` | `/改名 <标题>` | 修改会话标题 |
 * | `/mode` | `/模式` | 查看当前会话模式（只读） |
 * | `/help` | `/帮助` | 显示指令列表 |
 */

function resolveDir(dirIdx: number | null, worktree: string): string {
  if (dirIdx === null || dirIdx < 1 || dirIdx > _projectDirs.length) return worktree
  return _projectDirs[dirIdx - 1]
}

function getNick(dir: string): string {
  const nick = basename(dir)
  return nick || dir
}

async function listAllSessions(client: any): Promise<{ flat: Session[]; dirMap: Map<string, number> }> {
  const flat: Session[] = []
  const dirMap = new Map<string, number>()
  for (let di = 0; di < _projectDirs.length; di++) {
    try {
      const resp: any = await client.session.list({ query: { directory: _projectDirs[di] } })
      const all: Session[] = Array.isArray(resp) ? resp : resp.data ?? []
      for (const s of all) {
        if (!s.parentID) {
          flat.push(s)
          dirMap.set(s.id, di)
        }
      }
    } catch { /* skip unreachable dirs */ }
  }
  return { flat, dirMap }
}

function formatDirSessions(
  flat: Session[],
  dirMap: Map<string, number>,
  currentSid: string | undefined,
): string[] {
  const lines: string[] = []
  let globalIdx = 0
  for (let di = 0; di < _projectDirs.length; di++) {
    const dirSessions = flat.filter(s => dirMap.get(s.id) === di)
    if (dirSessions.length === 0) continue
    const dirName = getNick(_projectDirs[di])
    lines.push(`📁 ${dirName} — ${dirSessions.length} 个会话`)
    for (const s of dirSessions) {
      globalIdx++
      const isCurrent = s.id === currentSid
      const icon = isCurrent ? WECHAT_ICON : ""
      const marker = isCurrent ? " [当前会话]" : ""
      lines.push(`  ${globalIdx}. ${icon}${stripIconPrefix(s.title)}${marker}`)
    }
    lines.push("")
  }
  return lines
}

async function handleCommand(
  cmd: string,
  senderId: string,
  account: WechatCredentials,
  client: any,
  worktree: string,
) {
  const parts = cmd.slice(1).split(/\s+/)
  let command = parts[0].toLowerCase()
  const args = parts.slice(1)

  // 兼容无空格参数：/switch3 → command="switch" args=["3"]
  const attached = command.match(/^(switch|切换|new|新建|unbind|解绑|mode|模式)(\d+)$/)
  if (attached) {
    command = attached[1]
    args.unshift(attached[2])
  }

  const wx = (text: string) => sendText(account, senderId, text, undefined, client)

  switch (command) {
    case "stop":
    case "停止": {
      log("CMD", "stop")
      const sid = wechatSid.get(senderId)
      if (sid) {
        try { await client.session.abort({ path: { id: sid } }) } catch { /* ok */ }
      }
      await wx("✅ 已中断当前任务")
      break
    }

    case "status":
    case "状态":
    case "会话": {
      const currentSid = wechatSid.get(senderId)
      log("STATUS", `senderId=${senderId} currentSid=${currentSid}`)
      try {
        const { flat, dirMap } = await listAllSessions(client)
        const sessionLines = formatDirSessions(flat, dirMap, currentSid)
        const lines = sessionLines.length ? sessionLines : ["  (无会话)"]
        lines.push("回复 /switch <编号> 切换会话")
        await wx(lines.join("\n"))
      } catch {
        await wx("获取状态失败")
      }
      break
    }

    // -------- 新建 --------
    case "new":
    case "new-session":
    case "新建": {
      log("CMD", "new-session")
      let targetDir: string | undefined
      const n = args.length > 0 ? parseInt(args[0], 10) : NaN
      if (!isNaN(n)) {
        try {
          const { flat } = await listAllSessions(client)
          const s = flat[n - 1]
          if (s?.directory) targetDir = s.directory
        } catch { /* best effort */ }
      }
      if (!targetDir) {
        const currentSid = wechatSid.get(senderId)
        targetDir = resolveDir(null, worktree)
      }
      try {
        const title = wechatTitle()
        const resp: any = await client.session.create({
          query: { directory: targetDir },
          body: { title },
        })
        const newSid = resp.id ?? resp.sessionID ?? resp.data?.id
        if (newSid) {
          wechatSid.set(senderId, newSid)
          sidTitle.set(newSid, title)
          saveSessionMapping(worktree)
          await updateSessionIcon(client, newSid, "normal")
          await wx(`✅ 已创建新会话 [${t(newSid)}]`)
        }
      } catch (err: any) {
        log("CMD_NEW_FAIL", `${err}`)
        await wx("❌ 创建会话失败")
      }
      break
    }

    case "switch":
    case "切换": {
      log("CMD", `switch ${args[0] ?? ""}`)
      const target = args.join(" ").trim()
      if (!target) {
        await wx("请指定会话编号或 ID，例如 /switch 2 或 /switch abc12345")
        break
      }
      try {
        const { flat } = await listAllSessions(client)
        let matched: Session | null = null

        const n = parseInt(target, 10)
        if (n >= 1 && n <= flat.length) {
          matched = flat[n - 1]
        } else {
          matched = flat.find(s => s.id.startsWith(target)) ?? null
        }

        if (!matched) {
          await wx(`❌ 未找到匹配的会话: ${target}`)
          break
        }
        const prevSid = wechatSid.get(senderId)
        wechatSid.set(senderId, matched.id)
        sidTitle.set(matched.id, matched.title)
        saveSessionMapping(worktree)
        if (prevSid && prevSid !== matched.id) {
          const prevTitle = sidTitle.get(prevSid)
          if (prevTitle && ICON_PREFIXES.some(p => prevTitle.startsWith(p))) {
            const clean = stripIconPrefix(prevTitle)
            try { await client.session.update({ path: { id: prevSid }, body: { title: clean } }) } catch { }
            sidTitle.set(prevSid, clean)
          }
        }
        await updateSessionIcon(client, matched.id, "normal")
        await wx(`✅ 已切换到会话: ${matched.title}`)
      } catch (err: any) {
        log("CMD_SWITCH_FAIL", `${err}`)
        await wx("❌ 切换会话失败")
      }
      break
    }

    case "confirm":
    case "批准": {
      const code = args[0]
      if (code) {
        if (resolvePermission(code, senderId, true)) {
          await wx(`✅ 已批准 #${code}`)
        } else {
          await wx(`❌ 未找到审批码 #${code}`)
        }
      } else {
        if (resolveLatestPermission(senderId, true)) {
          await wx(`✅ 已批准`)
        } else {
          await wx(`当前没有待审批的请求`)
        }
      }
      break
    }

    case "deny":
    case "拒绝": {
      const code = args[0]
      if (code) {
        if (resolvePermission(code, senderId, false)) {
          await wx(`✅ 已拒绝 #${code}`)
        } else {
          await wx(`❌ 未找到审批码 #${code}`)
        }
      } else {
        if (resolveLatestPermission(senderId, false)) {
          await wx(`✅ 已拒绝`)
        } else {
          await wx(`当前没有待审批的请求`)
        }
      }
      break
    }

    // -------- 解绑 --------
    case "unbind":
    case "解绑": {
      log("CMD", "unbind")
      const oldSid = wechatSid.get(senderId)
      if (!oldSid) {
        let sessionsBlock = ""
        try {
          const { flat, dirMap } = await listAllSessions(client)
          const sessionLines = formatDirSessions(flat, dirMap, undefined)
          if (sessionLines.length > 0) sessionsBlock = "\n" + sessionLines.join("\n")
        } catch { /* best effort */ }
        await wx(`你好，我是 WeChat 桥接 🤖${sessionsBlock}\n\n回复 /switch <编号> 切换会话\n或直接发送你的问题，我将创建新会话处理。`)
        break
      }
      const prevTitle = sidTitle.get(oldSid)
      if (prevTitle && ICON_PREFIXES.some(p => prevTitle.startsWith(p))) {
        const clean = stripIconPrefix(prevTitle)
        try { await client.session.update({ path: { id: oldSid }, body: { title: clean } }) } catch { }
        sidTitle.set(oldSid, clean)
      }
      wechatSid.delete(senderId)
      saveSessionMapping(worktree)
      await wx("✅ 已解绑")
      _pendingFirstContact.add(senderId)
      setTimeout(() => _pendingFirstContact.delete(senderId), 10 * 60 * 1000)
      let sessionsBlock = ""
      try {
        const { flat, dirMap } = await listAllSessions(client)
        const sessionLines = formatDirSessions(flat, dirMap, undefined)
        if (sessionLines.length > 0) sessionsBlock = "\n" + sessionLines.join("\n")
      } catch { /* best effort */ }
      await wx(`你好，我是 WeChat 桥接 🤖${sessionsBlock}\n\n回复 /switch <编号> 切换会话\n或直接发送你的问题，我将创建新会话处理。`)
      break
    }

    // -------- 重命名 --------
    case "rename":
    case "改名": {
      log("CMD", `rename ${args.join(" ").slice(0, 40)}`)
      const newName = args.join(" ").trim()
      if (!newName) {
        await wx("请指定新标题，例如 /rename 我的会话")
        break
      }
      const sid = wechatSid.get(senderId)
      if (!sid) {
        await wx("当前未绑定会话")
        break
      }
      const oldTitle = sidTitle.get(sid) ?? ""
      const base = stripIconPrefix(oldTitle)
      try {
        await client.session.update({ path: { id: sid }, body: { title: newName } })
        sidTitle.set(sid, `${WECHAT_ICON}${newName}`)
        log("SESSION", `[${base}] → [${newName}]`)
        await wx(`✅ 已重命名: ${newName}`)
      } catch (err: any) {
        log("CMD_RENAME_FAIL", `${err}`)
        await wx("❌ 重命名失败")
      }
      break
    }

    // -------- 切换模式 / 查询模式 --------
    case "mode":
    case "模式": {
      log("CMD", `mode ${args[0] ?? ""}`)
      const sid = wechatSid.get(senderId)
      if (!sid) {
        await wx("当前未绑定会话")
        break
      }
      const target = args.join(" ").trim().toLowerCase()
      if (!target) {
        try {
          const resp = await client.session.messages({ path: { id: sid }, query: { limit: 5 } })
          const msgs = Array.isArray(resp) ? resp : resp.data ?? []
          let mode: string | undefined
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].info?.role === "assistant") {
              mode = msgs[i].info.mode
              break
            }
          }
          if (!mode && _modeCache.has(sid)) mode = _modeCache.get(sid)!
          await wx(`当前模式: ${mode ?? "build"}`)
        } catch {
          await wx(`当前模式: ${_modeCache.get(sid) ?? "build"}`)
        }
        break
      }
      await wx("模式切换请到 OC 终端输入 /mode plan 或 /mode build")
      break
    }

    // -------- 帮助 --------
    case "help":
    case "帮助": {
      const helpLines = ["--- 指令 ---", "/stop /status /switch N /new N", "/unbind /rename /mode /help", "--- 审批 ---", "同意 或 拒绝"]
      await wx(helpLines.join("\n"))
      break
    }

    default:
      await wx(`未知指令: /${command}\n支持: /stop /停止, /status /状态, /switch /切换, /new /新建, /unbind /解绑, /rename /改名, /mode /模式, /help /帮助\n审批回复：同意 或 拒绝`)
  }
}

// ============================================================
// Section 10c:  First Contact Wizard
// ============================================================

async function handleFirstContact(
  text: string,
  senderId: string,
  account: WechatCredentials,
  client: any,
  worktree: string,
): Promise<boolean> {
  if (_pendingFirstContact.has(senderId)) {
    _pendingFirstContact.delete(senderId)
    return false
  }

  _pendingFirstContact.add(senderId)
  setTimeout(() => _pendingFirstContact.delete(senderId), 10 * 60 * 1000)

  let sessionsBlock = ""
  try {
    const { flat, dirMap } = await listAllSessions(client)
    const sessionLines = formatDirSessions(flat, dirMap, undefined)
    if (sessionLines.length > 0) sessionsBlock = "\n" + sessionLines.join("\n")
  } catch { /* best effort */ }

  const intro = `你好，我是 WeChat 桥接 🤖
请告诉我你想做什么，我会创建合适的对话。
${sessionsBlock}

回复 /switch <编号> 切换会话
或直接发送你的问题，我将创建新会话处理。`

  await sendText(account, senderId, intro, undefined, null)
  log("FIRST", `intro sent to ${senderId.slice(0, 16)}`)
  return true
}

// ============================================================
// Section 11:  Plugin Entry
// ============================================================

// ---- 模块级可变状态（后台初始化完成前 hooks 跳过） ----
let _creds: WechatCredentials | null = null

/** 后台初始化：凭据加载 → 登录 → 轮询循环 */
async function lazyInit(client: any, worktree: string, signal: AbortSignal) {
  try {
    let creds = loadCredentials()
    if (!creds) {
      creds = await qrCodeLogin()
    } else {
      try {
        const reason = await validateCredentials(creds)
        if (reason) {
          log("CRED", `${reason}, re-login`)
          creds = await qrCodeLogin()
        } else {
          log("CRED", `loaded: ${creds.accountId}`)
        }
      } catch {
        log("CRED", `loaded (unverified): ${creds.accountId}`)
      }
    }
    _creds = creds
    startPollingLoop(creds, client, signal, worktree)
  } catch (err: any) {
    log("FATAL", `lazyInit failed: ${err.message}`)
  }
}

export const WechatBridgePlugin: Plugin = async ({ client, worktree }) => {
  try { mkdirSync(dirname(LOG_PATH), { recursive: true }) } catch { /* ok */ }
  log("INFO", `++++++++ wechat-bridge plugin loaded ++++++++ worktree=${worktree}`)

  try {
    await client.app.log({
      body: { service: "wechat-bridge", level: "info", message: "plugin loaded" },
    })
  } catch { /* best effort */ }

  migrateOldDataDir()
  initSessionCache(client)
  loadSessionMapping(worktree)
  _projectDirs = findProjectDirs(worktree)

  // 非阻塞：后台初始化，不阻塞 OC 启动
  const abortController = new AbortController()
  lazyInit(client, worktree, abortController.signal)

  return {
    event: createEventHandler(client),
    "permission.ask": createPermissionHandler(client),
    "experimental.chat.system.transform": async (_input: any, output: { system: string[] }) => {
      try {
        const { flat, dirMap } = await listAllSessions(client)
        if (flat.length === 0) return
        const sessionLines = formatDirSessions(flat, dirMap, undefined)
        const lines = ["当前可用的会话：", ...sessionLines]
        lines.push("")
        lines.push("用户输入以 ！ 或 ! 开头的消息时，这是跨会话指令：")
        lines.push("  - ！会话 或 !sessions → 调用 list_sessions 工具，直接返回工具的输出内容，不要重新排版")
        lines.push("  - ！<前缀> <消息> 或 !<前缀> <消息> → 调用 forward_to_session 工具转发")
        output.system.push(lines.join("\n"))
      } catch { /* best effort */ }
    },
    tool: createTools(client),
  }
}

// ============================================================
// Section 12:  Event Hooks
// ============================================================

function createEventHandler(client: any) {
  return async ({ event }: { event: any }) => {
    if (!_creds) return

    if (event.type === "session.idle") {
      const ev = event as EventSessionIdle
      const sid = ev.properties.sessionID
      log("IDLE", `[${t(sid)}] AI completed`)

      const wechatId = findWechatSender(sid)
      if (!wechatId) return

      _fwdLastTool.delete(sid)
      _thinkingSent.delete(sid)
      _fwdQueue.delete(sid)

      await updateSessionIcon(client, sid, "normal")

      // 收集当前轮次的工具名（仅用于日志），文字已通过 message.part.updated 实时发出
      const toolNames: string[] = []
      try {
        const msgsResp: any = await client.session.messages({ path: { id: sid }, query: { limit: 15 } })
        const msgs = Array.isArray(msgsResp) ? msgsResp : msgsResp.data ?? []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i]
          if (msg.info?.role === "assistant") {
            if (msg.info.mode) _modeCache.set(sid, msg.info.mode)
            for (const p of (Array.isArray(msg.parts) ? msg.parts : [])) {
              if (p.type === "tool") {
                const name = p.tool ?? ""
                if (name && !toolNames.includes(name)) toolNames.push(name)
              }
            }
          }
          if (msg.info?.role === "user") break
        }
      } catch (err) {
        log("IDLE_GET_MSG_FAIL", `${err}`)
      }

      _thinkingSent.delete(sid)

      // auto-continue：AI 出错后自动重试
      if (_pendingContinue.has(sid)) {
        _pendingContinue.delete(sid)
        try {
          const contResp: any = await client.session.prompt({
            path: { id: sid },
            body: { parts: [{ type: "text" as any, text: "检测到错误，继续你刚才的工作" }] },
          })
          const contMsgId = contResp?.info?.id ?? contResp?.id
          if (contMsgId) {
            _skipMsgIds.add(contMsgId)
            if (_skipMsgIds.size > 500) _skipMsgIds.clear()
          }
          log("AUTO_CONT", `[${t(sid)}] resume sent msg=${contMsgId?.slice(0, 16)}`)
        } catch (err) {
          log("AUTO_CONT_FAIL", `[${t(sid)}] ${err}`)
        }
      }
      return
    }

    if (event.type === "session.compacted") {
      const sid = (event as any).properties?.sessionID
      if (sid) {
        try {
          const contResp: any = await client.session.prompt({
            path: { id: sid },
            body: { parts: [{ type: "text" as any, text: "继续当前工作，注意本目录的规则文件 AGENTS.md 已更新" }] },
          })
          const contMsgId = contResp?.info?.id ?? contResp?.id
          if (contMsgId) {
            _skipMsgIds.add(contMsgId)
            if (_skipMsgIds.size > 500) _skipMsgIds.clear()
          }
          log("AUTO_CONT", `[${t(sid)}] compact resume sent msg=${contMsgId?.slice(0, 16)}`)
        } catch (err) {
          log("AUTO_CONT_FAIL", `[${t(sid)}] ${err}`)
        }
      }
      return
    }

    if (event.type === "message.updated") {
      const info = event.properties?.info
      if (info?.id) {
        if ((info as any).role === "user") {
          _userMsgIds.add(info.id)
          if (_userMsgIds.size > 1000) _userMsgIds.clear()
        } else if ((info as any).role === "assistant" && info.error) {
          _pendingContinue.add(info.sessionID)
      if (_pendingContinue.size > 500) _pendingContinue.clear()
          log("AUTO_CONT", `[${t(info.sessionID)}] error=${JSON.stringify(info.error).slice(0, 80)}`)
        }
      }
      return
    }

    if (event.type === "session.created") {
      const ev = event as EventSessionCreated
      const s = ev.properties.info
      if (!s.parentID) {
        sidTitle.set(s.id, s.title)
        log("SESSION", `[${t(s.id)}] created`)
      }
      return
    }

    if (event.type === "session.deleted") {
      const ev = event as EventSessionDeleted
      const s = ev.properties.info
      sidTitle.delete(s.id)
      _modeCache.delete(s.id)
      for (const [wx, sid] of wechatSid) {
        if (sid === s.id) { wechatSid.delete(wx); break }
      }
      log("SESSION", `[${t(s.id)}] deleted`)
      return
    }

    if (event.type === "session.updated") {
      const ev: any = event
      const s: Session = ev.properties.info
      if (!s.parentID && sidTitle.has(s.id) && sidTitle.get(s.id) !== s.title) {
        const old = sidTitle.get(s.id)!
        sidTitle.set(s.id, s.title)
        log("SESSION", `[${old}] → [${s.title}]`)
      }
      return
    }

    if (event.type === "permission.updated") {
      const p = event.properties
      if (p?.sessionID && p?.id) {
        const wechatId = findWechatSender(p.sessionID)
        if (wechatId) {
          _pendingPermByWx.set(wechatId, { sessionID: p.sessionID, permissionID: p.id })
          setTimeout(() => { if (_pendingPermByWx.get(wechatId)?.permissionID === p.id) _pendingPermByWx.delete(wechatId) }, 5 * 60 * 1000)
          const desc = p.metadata?.command ?? p.title ?? `工具: ${p.type}`
          try {
            await sendText(_creds!, wechatId, `需要确认：${desc.slice(0, 200)}？\n回复 同意 或 拒绝`, undefined, client)
            log("PERM_SENT", `permission=${p.id.slice(0, 16)} to ${wechatId.slice(0, 16)}`)
          } catch { /* best effort */ }
        }
      }
      return
    }

    if (event.type === "message.part.updated") {
      const p = event.properties?.part
      const sid = p?.sessionID
      if (!sid || _skipMsgIds.has(p.messageID)) return
      const wxId = findWechatSender(sid)
      if (!wxId) return
      if (p.type === "reasoning") {
        if (p.text && !_thinkingSent.has(sid)) {
          _thinkingSent.add(sid)
          enqueueSend(sid, () => sendText(_creds!, wxId, "思考中...", undefined, client))
        }
      } else if (p.type === "tool") {
        const name = p.tool ?? ""
        if (name && _fwdLastTool.get(sid) !== name) {
          _fwdLastTool.set(sid, name)
          enqueueSend(sid, () => sendText(_creds!, wxId, name, undefined, client))
        }
      } else if (p.type === "text" && !p.ignored && !p.synthetic && !_userMsgIds.has(p.messageID)) {
        const t = p.text?.trim()
        if (t) {
          enqueueSend(sid, () => sendText(_creds!, wxId, t, undefined, client))
        }
      }
      return
    }
  }
}

// ============================================================
// Section 12b:  Permission Handler (fallback for OC hook)
// ============================================================

function createPermissionHandler(client: any) {
  return async (input: any, output: { status: "ask" | "deny" | "allow" }) => {
    output.status = "ask"
  }
}

// ============================================================
// Section 13:  Optional Tools
// ============================================================

function createTools(client: any) {
  return {
    wechat_status: tool({
      description: "查看微信桥接插件的当前状态，包括登录账户、连接状态、缓存会话数",
      args: {},
      execute: async () => {
        if (!_creds) return { output: "微信桥接尚未完成登录" }
        const lines = [
          `微信账户: ${_creds.accountId}`,
          `绑定用户: ${_creds.userId ?? "(无)"}`,
          `会话缓存: ${sidTitle.size} 个`,
          `上下文令牌: ${contextTokens.size} 个`,
          `同步游标: ${syncBuffer ? "存在" : "无"}`,
          `数据目录: ${DATA_DIR}`,
        ]
        return { output: lines.join("\n") }
      },
    }),
    list_sessions: tool({
      description: "列出所有可用会话的标题和 ID",
      args: {},
      execute: async (_args: any, ctx: any) => {
        try {
          const { flat, dirMap } = await listAllSessions(client)
          if (flat.length === 0) return { output: "暂无会话" }
          const sessionLines = formatDirSessions(flat, dirMap, ctx?.sessionID)
          return { output: sessionLines.join("\n") }
        } catch {
          return { output: "获取会话列表失败" }
        }
      },
    }),
    forward_to_session: tool({
      description: "转发消息到标题前缀匹配的会话。用户说「转发」时使用此工具",
      args: {
        prefix: tool.schema.string().describe("目标会话标题前缀，如「WeChat」「改造」等"),
        message: tool.schema.string().describe("要转发的消息内容"),
      },
      execute: async (args, ctx) => {
        try {
          const { flat } = await listAllSessions(client)
          const target = flat.find(s => s.title.startsWith(args.prefix))
          if (!target) return { output: `未找到标题以「${args.prefix}」开头的会话` }
          if (target.id === ctx?.sessionID) return { output: "不能转发给自己" }
          const sourceTitle = sidTitle.get(ctx?.sessionID) ?? "未知"
          const text = `[转发自「${sourceTitle}」] ${args.message}`
          client.session.prompt({
            path: { id: target.id },
            body: { noReply: false, parts: [{ type: "text" as any, text }] },
          }).catch((err: any) => log("FWD_ERR", `${err}`))
          return { output: `✅ 已转发给「${target.title}」` }
        } catch {
          return { output: "转发失败" }
        }
      },
    }),
  }
}
