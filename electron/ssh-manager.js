const { Client } = require('ssh2')
const fs = require('fs')

class SshManager {
  constructor() {
    this.connections = new Map()
    this.mainWindow = null
  }

  setWindow(win) {
    this.mainWindow = win
  }

  _emit(event, channelId, ...args) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(event, channelId, ...args)
    }
  }

  connect(channelId, config) {
    return new Promise((resolve, reject) => {
      if (config.jumpHost && config.jumpHost.trim()) {
        this._connectViaJump(channelId, config, resolve, reject)
      } else {
        this._connectDirect(channelId, config, resolve, reject)
      }
    })
  }

  _buildConnConfig(config) {
    const connConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    }
    if (config.authType === 'key' && config.keyPath) {
      connConfig.privateKey = fs.readFileSync(config.keyPath)
      if (config.passphrase) connConfig.passphrase = config.passphrase
    } else {
      connConfig.password = config.password || ''
    }
    return connConfig
  }

  _openShell(channelId, client, jumpClient, resolve, reject) {
    client.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
      if (err) {
        client.end()
        if (jumpClient) jumpClient.end()
        reject(err)
        return
      }

      this.connections.set(channelId, { client, jumpClient: jumpClient || null, stream, sftp: null })

      stream.on('data', (data) => {
        this._emit('ssh:data', channelId, data.toString('utf8'))
      })
      stream.stderr.on('data', (data) => {
        this._emit('ssh:data', channelId, data.toString('utf8'))
      })
      stream.on('close', () => {
        this.connections.delete(channelId)
        if (jumpClient) try { jumpClient.end() } catch (_) {}
        this._emit('ssh:close', channelId)
      })

      resolve({ channelId })
    })
  }

  _connectDirect(channelId, config, resolve, reject) {
    const client = new Client()
    const connConfig = this._buildConnConfig(config)

    client.on('ready', () => {
      this._openShell(channelId, client, null, resolve, reject)
    })
    client.on('error', (err) => {
      this.connections.delete(channelId)
      this._emit('ssh:error', channelId, err.message)
      reject(err)
    })
    client.on('end', () => {
      this.connections.delete(channelId)
      this._emit('ssh:close', channelId)
    })

    try { client.connect(connConfig) } catch (e) { reject(e) }
  }

  _connectViaJump(channelId, config, resolve, reject) {
    const jumpClient = new Client()
    const jumpConfig = {
      host: config.jumpHost.trim(),
      port: parseInt(config.jumpPort, 10) || 22,
      username: config.jumpUsername || '',
    }
    if (config.jumpAuthType === 'key' && config.jumpKeyPath) {
      jumpConfig.privateKey = fs.readFileSync(config.jumpKeyPath)
      if (config.jumpPassphrase) jumpConfig.passphrase = config.jumpPassphrase
    } else {
      jumpConfig.password = config.jumpPassword || ''
    }

    jumpClient.on('ready', () => {
      jumpClient.forwardOut('127.0.0.1', 0, config.host, config.port || 22, (err, stream) => {
        if (err) { jumpClient.end(); reject(err); return }

        const client = new Client()
        const connConfig = {
          sock: stream,
          username: config.username,
        }
        if (config.authType === 'key' && config.keyPath) {
          connConfig.privateKey = fs.readFileSync(config.keyPath)
          if (config.passphrase) connConfig.passphrase = config.passphrase
        } else {
          connConfig.password = config.password || ''
        }

        client.on('ready', () => {
          this._openShell(channelId, client, jumpClient, resolve, reject)
        })
        client.on('error', (err) => {
          this.connections.delete(channelId)
          try { jumpClient.end() } catch (_) {}
          this._emit('ssh:error', channelId, err.message)
          reject(err)
        })

        try { client.connect(connConfig) } catch (e) { jumpClient.end(); reject(e) }
      })
    })

    jumpClient.on('error', (err) => {
      this._emit('ssh:error', channelId, `Jump host error: ${err.message}`)
      reject(err)
    })

    try { jumpClient.connect(jumpConfig) } catch (e) { reject(e) }
  }

  write(channelId, data) {
    const conn = this.connections.get(channelId)
    if (conn && conn.stream) conn.stream.write(data)
  }

  resize(channelId, cols, rows) {
    const conn = this.connections.get(channelId)
    if (conn && conn.stream) conn.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(channelId) {
    const conn = this.connections.get(channelId)
    if (conn) {
      try { conn.stream.close() } catch (_) {}
      try { conn.client.end() } catch (_) {}
      try { conn.jumpClient?.end() } catch (_) {}
      this.connections.delete(channelId)
    }
  }

  // ── SFTP ─────────────────────────────────────────────────────────────────────

  _getSftp(channelId) {
    return new Promise((resolve, reject) => {
      const conn = this.connections.get(channelId)
      if (!conn) return reject(new Error('No connection for channelId: ' + channelId))
      if (conn.sftp) return resolve(conn.sftp)
      conn.client.sftp((err, sftp) => {
        if (err) return reject(err)
        conn.sftp = sftp
        resolve(sftp)
      })
    })
  }

  async sftpList(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) return reject(err)
        const items = list.map((item) => ({
          name: item.filename,
          longname: item.longname,
          type: item.attrs.isDirectory() ? 'd' : 'f',
          size: item.attrs.size,
          mtime: item.attrs.mtime,
          permissions: item.attrs.mode,
        }))
        items.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'd' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        resolve(items)
      })
    })
  }

  async sftpDownload(channelId, remotePath, localPath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {}, (err) => {
        if (err) return reject(err)
        resolve({ success: true })
      })
    })
  }

  async sftpUpload(channelId, localPath, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {}, (err) => {
        if (err) return reject(err)
        resolve({ success: true })
      })
    })
  }

  async sftpRename(channelId, oldPath, newPath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) return reject(err)
        resolve({ success: true })
      })
    })
  }

  _sftpDeleteRecursive(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          // Not a directory — try unlink as file
          sftp.unlink(remotePath, (err2) => {
            if (err2) reject(new Error(`Cannot delete "${remotePath}": ${err2.message}`))
            else resolve()
          })
          return
        }
        // Directory — delete all children then rmdir
        const children = list || []
        const next = (i) => {
          if (i >= children.length) {
            sftp.rmdir(remotePath, (e) => { if (e) reject(e); else resolve() })
            return
          }
          const child = remotePath.replace(/\/$/, '') + '/' + children[i].filename
          this._sftpDeleteRecursive(sftp, child).then(() => next(i + 1)).catch(reject)
        }
        next(0)
      })
    })
  }

  async sftpDelete(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    await this._sftpDeleteRecursive(sftp, remotePath)
    return { success: true }
  }

  async sftpMkdir(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) return reject(err)
        resolve({ success: true })
      })
    })
  }

  async sftpRealpath(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.realpath(remotePath, (err, resolvedPath) => {
        if (err) return reject(err)
        resolve(resolvedPath)
      })
    })
  }

  disconnectAll() {
    for (const [channelId] of this.connections) {
      this.disconnect(channelId)
    }
  }
}

module.exports = new SshManager()
