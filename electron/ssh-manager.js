const { Client } = require('ssh2')
const fs = require('fs')

class SshManager {
  constructor() {
    // channelId -> { client, stream, sftp }
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
      const client = new Client()

      const connConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
      }

      if (config.authType === 'key' && config.keyPath) {
        try {
          connConfig.privateKey = fs.readFileSync(config.keyPath)
          if (config.passphrase) {
            connConfig.passphrase = config.passphrase
          }
        } catch (e) {
          reject(new Error(`Cannot read key file: ${e.message}`))
          return
        }
      } else {
        connConfig.password = config.password || ''
      }

      client.on('ready', () => {
        client.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
          if (err) {
            client.end()
            reject(err)
            return
          }

          this.connections.set(channelId, { client, stream, sftp: null })

          stream.on('data', (data) => {
            this._emit('ssh:data', channelId, data.toString('utf8'))
          })

          stream.stderr.on('data', (data) => {
            this._emit('ssh:data', channelId, data.toString('utf8'))
          })

          stream.on('close', () => {
            this.connections.delete(channelId)
            this._emit('ssh:close', channelId)
          })

          resolve({ channelId })
        })
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

      try {
        client.connect(connConfig)
      } catch (e) {
        reject(e)
      }
    })
  }

  write(channelId, data) {
    const conn = this.connections.get(channelId)
    if (conn && conn.stream) {
      conn.stream.write(data)
    }
  }

  resize(channelId, cols, rows) {
    const conn = this.connections.get(channelId)
    if (conn && conn.stream) {
      conn.stream.setWindow(rows, cols, 0, 0)
    }
  }

  disconnect(channelId) {
    const conn = this.connections.get(channelId)
    if (conn) {
      try { conn.stream.close() } catch (_) {}
      try { conn.client.end() } catch (_) {}
      this.connections.delete(channelId)
    }
  }

  // SFTP operations
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

  async sftpDelete(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (err) => {
        if (err) {
          // try rmdir for directories
          sftp.rmdir(remotePath, (err2) => {
            if (err2) return reject(err)
            resolve({ success: true })
          })
          return
        }
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

  async sftpMkdir(channelId, remotePath) {
    const sftp = await this._getSftp(channelId)
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) return reject(err)
        resolve({ success: true })
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
