const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ssh: {
    connect: (channelId, config) => ipcRenderer.invoke('ssh:connect', channelId, config),
    write: (channelId, data) => ipcRenderer.send('ssh:write', channelId, data),
    resize: (channelId, cols, rows) => ipcRenderer.send('ssh:resize', channelId, cols, rows),
    disconnect: (channelId) => ipcRenderer.invoke('ssh:disconnect', channelId),
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
    rename: (channelId, oldPath, newPath) =>
      ipcRenderer.invoke('sftp:rename', channelId, oldPath, newPath),
    delete: (channelId, path) => ipcRenderer.invoke('sftp:delete', channelId, path),
    mkdir: (channelId, path) => ipcRenderer.invoke('sftp:mkdir', channelId, path),
    realpath: (channelId, path) => ipcRenderer.invoke('sftp:realpath', channelId, path),
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
  platform: process.platform,
})
