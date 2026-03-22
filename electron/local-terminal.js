const os = require('os')

// node-pty gives proper PTY semantics (arrow keys, Ctrl+C, resize, TUIs).
// Fall back to child_process.spawn if node-pty is unavailable or fails to load.
let pty = null
try { pty = require('node-pty') } catch (_) {}

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
      const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      const cwd = options.cwd || os.homedir()

      const args = options.args || (isWin && !options.args ? [] : [])

      if (pty) {
        // PTY path — full terminal semantics
        let ptyProcess
        try {
          ptyProcess = pty.spawn(shell, args, {
            name: 'xterm-256color',
            cols: options.cols || 80,
            rows: options.rows || 24,
            cwd,
            env,
          })
        } catch (err) {
          return reject(err)
        }

        this.processes.set(channelId, { kind: 'pty', proc: ptyProcess })

        ptyProcess.onData((data) => this._emit('ssh:data', channelId, data))
        ptyProcess.onExit(() => {
          this.processes.delete(channelId)
          this._emit('ssh:close', channelId)
        })

        resolve({ channelId })
      } else {
        // Pipe fallback — limited (no resize, no interactive TUIs)
        const { spawn } = require('child_process')
        let proc
        try {
          proc = spawn(shell, options.args !== undefined ? options.args : (isWin ? ['-NoLogo'] : []), {
            env, cwd, windowsHide: true,
          })
        } catch (err) {
          return reject(err)
        }

        this.processes.set(channelId, { kind: 'spawn', proc })

        proc.stdout.on('data', (d) => this._emit('ssh:data', channelId, d.toString('utf8')))
        proc.stderr.on('data', (d) => this._emit('ssh:data', channelId, d.toString('utf8')))
        proc.on('close', () => { this.processes.delete(channelId); this._emit('ssh:close', channelId) })
        proc.on('error', (err) => { this.processes.delete(channelId); this._emit('ssh:error', channelId, err.message) })

        resolve({ channelId })
      }
    })
  }

  write(channelId, data) {
    const entry = this.processes.get(channelId)
    if (!entry) return
    if (entry.kind === 'pty') entry.proc.write(data)
    else if (entry.proc.stdin.writable) entry.proc.stdin.write(data)
  }

  resize(channelId, cols, rows) {
    const entry = this.processes.get(channelId)
    if (entry?.kind === 'pty') {
      try { entry.proc.resize(cols, rows) } catch (_) {}
    }
  }

  disconnect(channelId) {
    const entry = this.processes.get(channelId)
    if (!entry) return
    try {
      if (entry.kind === 'pty') entry.proc.kill()
      else { try { entry.proc.stdin.end() } catch (_) {}; entry.proc.kill() }
    } catch (_) {}
    this.processes.delete(channelId)
  }

  disconnectAll() {
    for (const [id] of this.processes) this.disconnect(id)
  }
}

module.exports = new LocalTerminalManager()
