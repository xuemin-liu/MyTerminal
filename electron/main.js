const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const Store = require('electron-store')
const Anthropic = require('@anthropic-ai/sdk').default
const sshManager = require('./ssh-manager')

const store = new Store({ name: 'sessions' })

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d1117',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  sshManager.setWindow(mainWindow)

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    sshManager.disconnectAll()
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
  if (process.platform !== 'darwin') app.quit()
})

// ── SSH IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('ssh:connect', async (_event, channelId, config) => {
  try {
    return await sshManager.connect(channelId, config)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('ssh:write', (_event, channelId, data) => {
  sshManager.write(channelId, data)
})

ipcMain.handle('ssh:resize', (_event, channelId, cols, rows) => {
  sshManager.resize(channelId, cols, rows)
})

ipcMain.handle('ssh:disconnect', (_event, channelId) => {
  sshManager.disconnect(channelId)
})

// ── SFTP IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('sftp:list', async (_event, channelId, remotePath) => {
  try {
    return await sshManager.sftpList(channelId, remotePath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:download', async (_event, channelId, remotePath, localPath) => {
  try {
    return await sshManager.sftpDownload(channelId, remotePath, localPath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:upload', async (_event, channelId, localPath, remotePath) => {
  try {
    return await sshManager.sftpUpload(channelId, localPath, remotePath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:rename', async (_event, channelId, oldPath, newPath) => {
  try {
    return await sshManager.sftpRename(channelId, oldPath, newPath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:delete', async (_event, channelId, remotePath) => {
  try {
    return await sshManager.sftpDelete(channelId, remotePath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:realpath', async (_event, channelId, remotePath) => {
  try {
    return await sshManager.sftpRealpath(channelId, remotePath)
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('sftp:mkdir', async (_event, channelId, remotePath) => {
  try {
    return await sshManager.sftpMkdir(channelId, remotePath)
  } catch (err) {
    return { error: err.message }
  }
})

// ── File dialog ────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFile', async (_event, options) => {
  return await dialog.showOpenDialog(mainWindow, options || {})
})

ipcMain.handle('dialog:saveFile', async (_event, options) => {
  return await dialog.showSaveDialog(mainWindow, options || {})
})

// ── Session persistence ────────────────────────────────────────────────────────

ipcMain.handle('sessions:getAll', () => {
  return store.get('sessions', [])
})

ipcMain.handle('sessions:save', (_event, session) => {
  const sessions = store.get('sessions', [])
  const idx = sessions.findIndex((x) => x.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.push(session)
  store.set('sessions', sessions)
  return sessions
})

ipcMain.handle('sessions:delete', (_event, id) => {
  const sessions = store.get('sessions', []).filter((x) => x.id !== id)
  store.set('sessions', sessions)
  return sessions
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
  store.set('settings.anthropicApiKey', key)
  return { success: true }
})

ipcMain.handle('ai:getKeyStatus', () => {
  const key = store.get('settings.anthropicApiKey', '')
  return key ? '••••' + key.slice(-4) : ''
})

ipcMain.handle('ai:complete', async (_event, { query, context, os }) => {
  const apiKey = store.get('settings.anthropicApiKey', '')
  if (!apiKey) return { error: 'NO_KEY' }

  const client = new Anthropic({ apiKey })

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
    if (raw.startsWith('CMD:')) {
      return { type: 'command', value: raw.slice(4).trim() }
    }
    if (raw.startsWith('TXT:')) {
      return { type: 'text', value: raw.slice(4).trim() }
    }
    // Fallback: single-line with no spaces → treat as command
    const text = raw.trim()
    const isCommand = !text.includes('\n') && text.split(' ').length <= 8
    return { type: isCommand ? 'command' : 'text', value: text }
  } catch (err) {
    return { error: err.message }
  }
})
