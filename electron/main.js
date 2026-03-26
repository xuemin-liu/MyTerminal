const { app, BrowserWindow, ipcMain, dialog, Notification, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const Anthropic = require('@anthropic-ai/sdk').default
const sshManager = require('./ssh-manager')
const localTerminalManager = require('./local-terminal')

const store = new Store({ name: 'sessions' })

// ── Credential encryption (safeStorage / OS keychain) ──────────────────────────
const SENSITIVE_FIELDS = ['password', 'passphrase', 'jumpPassword', 'jumpPassphrase']

function encryptField(value) {
  if (!value || typeof value !== 'string') return value
  if (!safeStorage.isEncryptionAvailable()) return value
  try { return Buffer.from(safeStorage.encryptString(value)).toString('base64') }
  catch { return value }
}

function decryptField(value) {
  if (!value || typeof value !== 'string') return value
  if (!safeStorage.isEncryptionAvailable()) return value
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')) }
  catch { return value } // plaintext fallback (migration from old format)
}

function encryptSession(session) {
  const enc = { ...session }
  for (const field of SENSITIVE_FIELDS) if (enc[field]) enc[field] = encryptField(enc[field])
  return enc
}

function decryptSession(session) {
  const dec = { ...session }
  for (const field of SENSITIVE_FIELDS) if (dec[field]) dec[field] = decryptField(dec[field])
  return dec
}

let mainWindow
let anthropicClient = null
let anthropicCachedKey = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d1117',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(app.getAppPath(), 'build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  sshManager.setWindow(mainWindow)
  localTerminalManager.setWindow(mainWindow)

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    sshManager.disconnectAll()
    localTerminalManager.disconnectAll()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sshManager.disconnectAll()
  localTerminalManager.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})

// ── SSH IPC ────────────────────────────────────────────────────────────────────

ipcMain.handle('ssh:connect', async (_event, channelId, config) => {
  try { return await sshManager.connect(channelId, config) }
  catch (err) { return { error: err.message } }
})
ipcMain.on('ssh:write', (_event, channelId, data) => sshManager.write(channelId, data))
ipcMain.on('ssh:resize', (_event, channelId, cols, rows) => sshManager.resize(channelId, cols, rows))
ipcMain.handle('ssh:disconnect', (_event, channelId) => sshManager.disconnect(channelId))

// ── Local terminal IPC ─────────────────────────────────────────────────────────

ipcMain.handle('local:spawn', async (_event, channelId, options) => {
  try { return await localTerminalManager.spawn(channelId, options) }
  catch (err) { return { error: err.message } }
})
ipcMain.on('local:write', (_event, channelId, data) => localTerminalManager.write(channelId, data))
ipcMain.on('local:resize', (_event, channelId, cols, rows) => localTerminalManager.resize(channelId, cols, rows))
ipcMain.handle('local:disconnect', (_event, channelId) => localTerminalManager.disconnect(channelId))

// ── SFTP IPC ───────────────────────────────────────────────────────────────────

ipcMain.handle('sftp:list', async (_event, channelId, remotePath) => {
  try { return await sshManager.sftpList(channelId, remotePath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:download', async (_event, channelId, remotePath, localPath) => {
  try { return await sshManager.sftpDownload(channelId, remotePath, localPath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:upload', async (_event, channelId, localPath, remotePath) => {
  try { return await sshManager.sftpUpload(channelId, localPath, remotePath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:rename', async (_event, channelId, oldPath, newPath) => {
  try { return await sshManager.sftpRename(channelId, oldPath, newPath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:delete', async (_event, channelId, remotePath) => {
  try { return await sshManager.sftpDelete(channelId, remotePath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:mkdir', async (_event, channelId, remotePath) => {
  try { return await sshManager.sftpMkdir(channelId, remotePath) }
  catch (err) { return { error: err.message } }
})
ipcMain.handle('sftp:realpath', async (_event, channelId, remotePath) => {
  try { return await sshManager.sftpRealpath(channelId, remotePath) }
  catch (err) { return { error: err.message } }
})

// ── File dialog ────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (_event, options) => {
  return await dialog.showOpenDialog(mainWindow, options || {})
})
ipcMain.handle('dialog:saveFile', async (_event, options) => {
  return await dialog.showSaveDialog(mainWindow, options || {})
})

// ── Session persistence ────────────────────────────────────────────────────────

ipcMain.handle('sessions:getAll', () => store.get('sessions', []).map(decryptSession))

ipcMain.handle('sessions:save', (_event, session) => {
  const sessions = store.get('sessions', [])
  const idx = sessions.findIndex((x) => x.id === session.id)
  const encrypted = encryptSession(session)
  if (idx >= 0) sessions[idx] = encrypted
  else sessions.push(encrypted)
  store.set('sessions', sessions)
  return sessions.map(decryptSession)
})

ipcMain.handle('sessions:delete', (_event, id) => {
  const sessions = store.get('sessions', []).filter((x) => x.id !== id)
  store.set('sessions', sessions)
  return sessions.map(decryptSession)
})

ipcMain.handle('sessions:export', async (_event, _sessions) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Sessions',
    defaultPath: 'myterminal-sessions.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled) return { canceled: true }
  // Export metadata only — passwords are machine-specific and cannot be decrypted on another device
  const exportable = store.get('sessions', []).map((s) => {
    const clean = decryptSession(s)
    for (const field of SENSITIVE_FIELDS) delete clean[field]
    return clean
  })
  fs.writeFileSync(result.filePath, JSON.stringify(exportable, null, 2), 'utf8')
  return { success: true }
})

ipcMain.handle('sessions:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Sessions',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled) return { canceled: true }
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8')
    const imported = JSON.parse(raw)
    if (!Array.isArray(imported)) return { error: 'Invalid file format' }
    const existing = store.get('sessions', [])
    const map = new Map(existing.map((s) => [s.id, s]))
    for (const s of imported) {
      if (s.id && s.host && s.username) map.set(s.id, encryptSession(s))
    }
    const merged = Array.from(map.values())
    store.set('sessions', merged)
    return merged.map(decryptSession)
  } catch (e) {
    return { error: e.message }
  }
})

// ── WSL ────────────────────────────────────────────────────────────────────────

ipcMain.handle('wsl:getDistros', () => {
  if (process.platform !== 'win32') return []
  // Use async execFile with a timeout so a slow/misconfigured WSL never
  // blocks the main-process event loop.
  const { execFile } = require('child_process')
  return new Promise((resolve) => {
    execFile('wsl.exe', ['--list', '--quiet'], { encoding: 'buffer', timeout: 5000 }, (err, stdout) => {
      if (err) { resolve([]); return }
      const distros = stdout
        .toString('utf16le')
        .split(/\r?\n/)
        .map((l) => l.replace(/\(Default\)/i, '').replace(/\x00/g, '').trim())
        .filter(Boolean)
      resolve(distros)
    })
  })
})

// ── SFTP Favorites ────────────────────────────────────────────────────────────

ipcMain.handle('favorites:get', (_event, sessionKey) => {
  const all = store.get('sftp-favorites', {})
  return all[sessionKey] || []
})

ipcMain.handle('favorites:set', (_event, sessionKey, paths) => {
  const all = store.get('sftp-favorites', {})
  all[sessionKey] = paths
  store.set('sftp-favorites', all)
})

// ── Snippets ───────────────────────────────────────────────────────────────────

ipcMain.handle('snippets:getAll', () => store.get('snippets', []))

ipcMain.handle('snippets:save', (_event, snippet) => {
  const snippets = store.get('snippets', [])
  const idx = snippets.findIndex((x) => x.id === snippet.id)
  if (idx >= 0) snippets[idx] = snippet
  else snippets.push(snippet)
  store.set('snippets', snippets)
  return snippets
})

ipcMain.handle('snippets:delete', (_event, id) => {
  const snippets = store.get('snippets', []).filter((x) => x.id !== id)
  store.set('snippets', snippets)
  return snippets
})

// ── Filter Presets ─────────────────────────────────────────────────────────────

ipcMain.handle('filterPresets:getAll', () => store.get('filter-presets', []))

ipcMain.handle('filterPresets:save', (_e, preset) => {
  const presets = store.get('filter-presets', [])
  if (presets.length >= 10) return presets
  presets.push(preset)
  store.set('filter-presets', presets)
  return presets
})

ipcMain.handle('filterPresets:delete', (_e, id) => {
  const presets = store.get('filter-presets', []).filter((x) => x.id !== id)
  store.set('filter-presets', presets)
  return presets
})

// ── Notifications ──────────────────────────────────────────────────────────────

ipcMain.handle('notify:send', (_event, title, body) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show()
  }
})

// ── Window controls ────────────────────────────────────────────────────────────

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── AI assistant ───────────────────────────────────────────────────────────────

ipcMain.handle('ai:setKey', (_event, key) => {
  store.set('settings.anthropicApiKey', encryptField(key))
  anthropicClient = null
  anthropicCachedKey = null
  return { success: true }
})

ipcMain.handle('ai:getKeyStatus', () => {
  const raw = store.get('settings.anthropicApiKey', '')
  if (!raw) return ''
  const key = decryptField(raw)
  return '••••' + key.slice(-4)
})

ipcMain.handle('ai:complete', async (_event, { query, context, os }) => {
  const raw = store.get('settings.anthropicApiKey', '')
  const apiKey = raw ? decryptField(raw) : ''
  if (!apiKey) return { error: 'NO_KEY' }

  if (apiKey !== anthropicCachedKey) {
    anthropicClient = new Anthropic({ apiKey })
    anthropicCachedKey = apiKey
  }
  const client = anthropicClient
  const userMessage = context
    ? `Terminal output:\n\`\`\`\n${context.slice(0, 6000)}\n\`\`\`\n\nUser request: ${query}`
    : query

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: `You are a terminal assistant. Convert requests into shell commands whenever possible.

Rules:
- DEFAULT to generating a shell command (CMD:) unless the request is purely theoretical with no actionable command.
- NEVER ask clarifying questions. Pick the most useful command and return it.
- If the request is ambiguous between a command and a question, always choose CMD:.
- For "is X running / killed / stopped" → generate a command to check, e.g.: pgrep -l X && echo running || echo "not running"
- For "kill X" or "stop X" → generate the kill command.
- For "check/verify X" → generate a command that checks it.
- Only use TXT: for pure explanations with no possible shell equivalent (e.g. "what is TCP?").
- Target OS: ${os || 'Linux'}.

Reply format — start with exactly one of:
CMD:<shell command only, no explanation>
TXT:<plain text answer, no markdown>`,
      messages: [{ role: 'user', content: userMessage }],
    })

    const raw = response.content[0].text.trim()
    if (raw.startsWith('CMD:')) return { type: 'command', value: raw.slice(4).trim() }
    if (raw.startsWith('TXT:')) return { type: 'text', value: raw.slice(4).trim() }
    const text = raw.trim()
    const isCommand = !text.includes('\n') && text.split(' ').length <= 8
    return { type: isCommand ? 'command' : 'text', value: text }
  } catch (err) {
    return { error: err.message }
  }
})
