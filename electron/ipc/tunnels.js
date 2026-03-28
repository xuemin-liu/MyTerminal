const { ipcMain } = require('electron')

module.exports = function registerTunnelHandlers(store, { sshManager, tunnelManager, assertString, assertPlainObject }) {
  ipcMain.handle('tunnel:start', async (_event, channelId, tunnelId, tunnelConfig) => {
    try {
      assertString(channelId, 'channelId')
      assertString(tunnelId, 'tunnelId')
      assertPlainObject(tunnelConfig, 'tunnelConfig')
      assertString(tunnelConfig.type, 'tunnelConfig.type')
      if (!['local', 'remote', 'dynamic'].includes(tunnelConfig.type)) {
        return { error: 'Unknown tunnel type' }
      }
      const conn = sshManager.connections.get(channelId)
      if (!conn) return { error: 'No SSH connection' }
      const client = conn.client

      if (tunnelConfig.type === 'local') {
        return await tunnelManager.startLocal(tunnelId, channelId, client, tunnelConfig)
      } else if (tunnelConfig.type === 'remote') {
        return await tunnelManager.startRemote(tunnelId, channelId, client, tunnelConfig)
      } else if (tunnelConfig.type === 'dynamic') {
        return await tunnelManager.startDynamic(tunnelId, channelId, client, tunnelConfig)
      }
      return { error: 'Unknown tunnel type' }
    } catch (err) { return { error: err.message } }
  })

  ipcMain.handle('tunnel:stop', (_event, tunnelId) => {
    tunnelManager.stop(tunnelId)
    return { success: true }
  })

  ipcMain.handle('tunnel:stopByChannel', (_event, channelId) => {
    return tunnelManager.stopByChannel(channelId)
  })

  ipcMain.handle('tunnel:list', () => tunnelManager.list())

  ipcMain.handle('tunnelConfigs:get', (_event, sessionId) => {
    return store.get(`tunnel-configs.${sessionId}`, [])
  })

  ipcMain.handle('tunnelConfigs:set', (_event, sessionId, configs) => {
    store.set(`tunnel-configs.${sessionId}`, configs)
  })
}
