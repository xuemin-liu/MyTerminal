const { spawn } = require('child_process')
const os = require('os')

class LocalTerminalManager {
  constructor() {
    this.processes = new Map()
    this.mainWindow = null
  }

  setWindow(win) { this.mainWindow = win }

  _emit(event, channelId, ...args) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(event, channelId, ...args)
    }
  }

  spawn(channelId, options = {}) {
    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32'
      const shell = options.shell || (isWin ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'))
      const args = isWin ? ['-NoLogo'] : []
      const env = { ...process.env, TERM: 'xterm-256color' }

      let proc
      try {
        proc = spawn(shell, args, {
          env,
          cwd: options.cwd || os.homedir(),
          windowsHide: true,
        })
      } catch (err) {
        return reject(err)
      }

      this.processes.set(channelId, proc)

      proc.stdout.on('data', (data) => {
        this._emit('ssh:data', channelId, data.toString('utf8'))
      })
      proc.stderr.on('data', (data) => {
        this._emit('ssh:data', channelId, data.toString('utf8'))
      })
      proc.on('close', () => {
        this.processes.delete(channelId)
        this._emit('ssh:close', channelId)
      })
      proc.on('error', (err) => {
        this.processes.delete(channelId)
        this._emit('ssh:error', channelId, err.message)
      })

      resolve({ channelId })
    })
  }

  write(channelId, data) {
    const proc = this.processes.get(channelId)
    if (proc && proc.stdin.writable) proc.stdin.write(data)
  }

  resize(channelId, cols, rows) {
    // Resize requires node-pty; child_process.spawn doesn't support it natively
  }

  disconnect(channelId) {
    const proc = this.processes.get(channelId)
    if (proc) {
      try { proc.stdin.end() } catch (_) {}
      try { proc.kill() } catch (_) {}
      this.processes.delete(channelId)
    }
  }

  disconnectAll() {
    for (const [id] of this.processes) this.disconnect(id)
  }
}

module.exports = new LocalTerminalManager()
