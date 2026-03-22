const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ssh: {
    connect: (channelId, config) => ipcRenderer.invoke('ssh:connect', channelId, config),
    write: (channelId, data) => ipcRenderer.invoke('ssh:write', channelId, data),
    resize: (channelId, cols, rows) => ipcRenderer.invoke('ssh:resize', channelId, cols, rows),
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
})
