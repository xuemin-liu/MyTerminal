const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ssh: {
    connect: (channelId, config) => ipcRenderer.invoke('ssh:connect', channelId, config),
    write: (channelId, data) => ipcRenderer.send('ssh:write', channelId, data),
    resize: (channelId, cols, rows) => ipcRenderer.send('ssh:resize', channelId, cols, rows),
    disconnect: (channelId) => ipcRenderer.invoke('ssh:disconnect', channelId),
    ping: (channelId) => ipcRenderer.invoke('ssh:ping', channelId),
    onData: (callback) => {
      const handler = (_event, channelId, data) => callback(channelId, data)
      ipcRenderer.on('ssh:data', handler)
      return () => ipcRenderer.removeListener('ssh:data', handler)
    },
    onClose: (callback) => {
      const handler = (_event, channelId) => callback(channelId)
      ipcRenderer.on('ssh:close', handler)
      return () => ipcRenderer.removeListener('ssh:close', handler)
    },
    onError: (callback) => {
      const handler = (_event, channelId, message) => callback(channelId, message)
      ipcRenderer.on('ssh:error', handler)
      return () => ipcRenderer.removeListener('ssh:error', handler)
    },
  },
  local: {
    spawn: (channelId, options) => ipcRenderer.invoke('local:spawn', channelId, options),
    write: (channelId, data) => ipcRenderer.send('local:write', channelId, data),
    resize: (channelId, cols, rows) => ipcRenderer.send('local:resize', channelId, cols, rows),
    disconnect: (channelId) => ipcRenderer.invoke('local:disconnect', channelId),
  },
  sftp: {
    list: (channelId, path) => ipcRenderer.invoke('sftp:list', channelId, path),
    download: (channelId, remotePath, localPath) =>
      ipcRenderer.invoke('sftp:download', channelId, remotePath, localPath),
    upload: (channelId, localPath, remotePath) =>
      ipcRenderer.invoke('sftp:upload', channelId, localPath, remotePath),
    uploadDir: (channelId, localDir, remoteDir) =>
      ipcRenderer.invoke('sftp:uploadDir', channelId, localDir, remoteDir),
    rename: (channelId, oldPath, newPath) =>
      ipcRenderer.invoke('sftp:rename', channelId, oldPath, newPath),
    delete: (channelId, path) => ipcRenderer.invoke('sftp:delete', channelId, path),
    mkdir: (channelId, path) => ipcRenderer.invoke('sftp:mkdir', channelId, path),
    realpath: (channelId, path) => ipcRenderer.invoke('sftp:realpath', channelId, path),
    readFile: (channelId, remotePath) => ipcRenderer.invoke('sftp:readFile', channelId, remotePath),
    writeFile: (channelId, remotePath, content) => ipcRenderer.invoke('sftp:writeFile', channelId, remotePath, content),
  },
  sessions: {
    getAll: () => ipcRenderer.invoke('sessions:getAll'),
    save: (session) => ipcRenderer.invoke('sessions:save', session),
    delete: (id) => ipcRenderer.invoke('sessions:delete', id),
    export: (sessions) => ipcRenderer.invoke('sessions:export', sessions),
    import: () => ipcRenderer.invoke('sessions:import'),
  },
  wsl: {
    getDistros: () => ipcRenderer.invoke('wsl:getDistros'),
  },
  favorites: {
    get: (sessionKey) => ipcRenderer.invoke('favorites:get', sessionKey),
    set: (sessionKey, paths) => ipcRenderer.invoke('favorites:set', sessionKey, paths),
  },
  snippets: {
    getAll: () => ipcRenderer.invoke('snippets:getAll'),
    save: (snippet) => ipcRenderer.invoke('snippets:save', snippet),
    delete: (id) => ipcRenderer.invoke('snippets:delete', id),
  },
  filterPresets: {
    getAll: () => ipcRenderer.invoke('filterPresets:getAll'),
    save: (preset) => ipcRenderer.invoke('filterPresets:save', preset),
    delete: (id) => ipcRenderer.invoke('filterPresets:delete', id),
  },
  tunnel: {
    start: (channelId, tunnelId, config) => ipcRenderer.invoke('tunnel:start', channelId, tunnelId, config),
    stop: (tunnelId) => ipcRenderer.invoke('tunnel:stop', tunnelId),
    stopByChannel: (channelId) => ipcRenderer.invoke('tunnel:stopByChannel', channelId),
    list: () => ipcRenderer.invoke('tunnel:list'),
    getConfigs: (sessionId) => ipcRenderer.invoke('tunnelConfigs:get', sessionId),
    setConfigs: (sessionId, configs) => ipcRenderer.invoke('tunnelConfigs:set', sessionId, configs),
  },
  logging: {
    start: (channelId, logDir) => ipcRenderer.invoke('logging:start', channelId, logDir),
    write: (channelId, data) => ipcRenderer.send('logging:write', channelId, data),
    stop: (channelId) => ipcRenderer.invoke('logging:stop', channelId),
    export: (content) => ipcRenderer.invoke('logging:export', content),
  },
  sshconfig: {
    import: () => ipcRenderer.invoke('sshconfig:import'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings),
  },
  workspace: {
    get: () => ipcRenderer.invoke('workspace:get'),
    set: (workspace) => ipcRenderer.invoke('workspace:set', workspace),
  },
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  ai: {
    complete: (params) => ipcRenderer.invoke('ai:complete', params),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    getKeyStatus: () => ipcRenderer.invoke('ai:getKeyStatus'),
  },
  notify: {
    send: (title, body) => ipcRenderer.invoke('notify:send', title, body),
  },
  fs: {
    isDirectory: (filePath) => ipcRenderer.invoke('fs:isDirectory', filePath),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  },
  // webUtils.getPathForFile needs the real File object which can't cross the
  // context-isolation bridge.  The preload captures drop events (same DOM,
  // different JS world) and stashes the resolved paths.  The renderer calls
  // getDropPaths() right after the drop event to retrieve them.
  getDropPaths: () => {
    const paths = _lastDropPaths.slice()
    _lastDropPaths.length = 0
    return paths
  },
  platform: process.platform,
})

const _lastDropPaths = []

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('drop', (e) => {
    _lastDropPaths.length = 0
    if (!e.dataTransfer?.files?.length) return
    for (const file of e.dataTransfer.files) {
      try { _lastDropPaths.push(webUtils.getPathForFile(file)) }
      catch { /* skip */ }
    }
  }, true)  // capture phase — runs before React's handler
})

