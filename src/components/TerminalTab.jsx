import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { PanelRight, Highlighter, Sparkles, ListFilter } from 'lucide-react'
import SftpPanel from './SftpPanel'
import AiBar from './AiBar'
import useSessionStore from '../store/useSessionStore'

const FILTER_PRESETS = [
  { label: 'Error',   color: '#ff7b72', pattern: 'error|errors|failed|failure|fatal|exception|traceback|critical' },
  { label: 'Warning', color: '#d29922', pattern: 'warning|warnings|warn|deprecated|caution' },
  { label: 'Info',    color: '#39c5cf', pattern: 'info|note|hint|notice' },
  { label: 'Success', color: '#3fb950', pattern: 'success|succeeded|done|ok|passed|complete|completed' },
]

// Build a case-insensitive regex from filter text (| = OR, everything else literal)
function buildFilterRegex(text) {
  const parts = text.split('|').map((p) => p.trim().replace(/[.*+?^${}()[\]\\]/g, '\\$&')).filter(Boolean)
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

// Colorize plain-text segments only (skip existing ANSI-colored spans)
function colorizeOutput(text) {
  // Split on ANSI escape sequences so we don't double-color already-colored text
  const parts = text.split(/(\x1b\[[0-9;]*m)/)
  let insideColor = false
  return parts.map((part) => {
    if (/^\x1b\[/.test(part)) {
      // Reset sequences end a colored span; anything else starts one
      insideColor = part !== '\x1b[0m' && part !== '\x1b[m'
      return part
    }
    if (insideColor) return part
    return part
      .replace(/\b(error|errors|failed|failure|fatal|exception|traceback|critical)\b/gi,
        '\x1b[1;31m$1\x1b[0m')  // bold red
      .replace(/\b(warning|warnings|warn|deprecated|caution)\b/gi,
        '\x1b[1;33m$1\x1b[0m')  // bold yellow
      .replace(/\b(info|note|hint|notice)\b/gi,
        '\x1b[36m$1\x1b[0m')    // cyan
      .replace(/\b(success|succeeded|done|ok|passed|complete|completed)\b/gi,
        '\x1b[32m$1\x1b[0m')    // green
  }).join('')
}

export default function TerminalTab({ tab }) {
  const termRef = useRef(null)
  const terminalInstanceRef = useRef(null)
  const fitAddonRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const [showSftp, setShowSftp] = useState(false)
  const [cwd, setCwd] = useState(null)
  const [sftpWidth, setSftpWidth] = useState(380)
  const dragRef = useRef(null)
  const [showAi, setShowAi] = useState(false)
  const [colorize, setColorize] = useState(true)
  const colorizeRef = useRef(true)
  const [ctxMenu, setCtxMenu] = useState(null)
  const [showFilter, setShowFilter] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [filterLines, setFilterLines] = useState([])
  const [activePreset, setActivePreset] = useState(null)
  const outputLinesRef = useRef([])   // plain-text line buffer (max 5000)
  const pendingLineRef = useRef('')   // incomplete line accumulator
  const filterInputRef = useRef(null)
  const filterResultsRef = useRef(null)
  const filterTextRef = useRef('')
  const { closeTab } = useSessionStore()
  const cleanupRef = useRef([])

  // Keep refs in sync so SSH data handler always sees latest values
  useEffect(() => { colorizeRef.current = colorize }, [colorize])
  useEffect(() => { filterTextRef.current = filterText }, [filterText])

  // Ctrl+K → AI bar, Ctrl+F → filter
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); setShowAi(true) }
      if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setShowFilter((v) => !v) }
      if (e.key === 'Escape') { setShowAi(false); setShowFilter(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Auto-focus filter input when opened
  useEffect(() => {
    if (showFilter) setTimeout(() => filterInputRef.current?.focus(), 50)
  }, [showFilter])

  // Re-run filter when text changes
  useEffect(() => {
    const re = buildFilterRegex(filterText)
    setFilterLines(re ? outputLinesRef.current.filter((l) => re.test(l)) : [])
  }, [filterText])

  // Scroll filter results to bottom when new lines arrive
  useEffect(() => {
    const el = filterResultsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filterLines])

  const handleContextMenu = (e) => {
    e.preventDefault()
    const hasSelection = terminalInstanceRef.current?.getSelection()?.length > 0
    setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection })
  }

  const handleCopy = () => {
    const sel = terminalInstanceRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel)
    setCtxMenu(null)
  }

  const handlePaste = async () => {
    const text = await navigator.clipboard.readText()
    if (text) window.electronAPI.ssh.write(tab.channelId, text)
    setCtxMenu(null)
  }

  // Close context menu on any click outside
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  useEffect(() => {
    // Create terminal instance
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    terminalInstanceRef.current = term
    fitAddonRef.current = fitAddon

    term.open(termRef.current)
    fitAddon.fit()

    term.write('\r\n\x1b[90mConnecting to ' + tab.config.host + '...\x1b[0m\r\n')

    // Connect SSH
    window.electronAPI.ssh.connect(tab.channelId, tab.config).then((result) => {
      if (result?.error) {
        setError(result.error)
        term.write('\r\n\x1b[31mError: ' + result.error + '\x1b[0m\r\n')
        return
      }
      setConnected(true)
      fitAddon.fit()
      const { cols, rows } = term
      window.electronAPI.ssh.resize(tab.channelId, cols, rows)
    })

    // AI inline mode — buffer typed characters to detect ?? prefix
    const AI_PREFIX = '??'
    let lineBuffer = ''
    let aiPending = false  // true while waiting for AI response

    const inputDisposer = term.onData((data) => {
      // If AI is processing, swallow all input
      if (aiPending) return

      const code = data.charCodeAt(0)

      // Backspace
      if (code === 127) {
        if (lineBuffer.length > 0) {
          lineBuffer = lineBuffer.slice(0, -1)
          // Only echo the backspace if we're still in AI-prefix territory
          // (normal shell echoes its own backspace, but we suppress AI-prefix chars)
          if (lineBuffer.startsWith(AI_PREFIX.slice(0, lineBuffer.length)) ||
              lineBuffer.startsWith(AI_PREFIX)) {
            term.write('\b \b')
            return
          }
        }
        window.electronAPI.ssh.write(tab.channelId, data)
        return
      }

      // Enter — check if current buffer is an AI query
      if (data === '\r') {
        if (lineBuffer.startsWith(AI_PREFIX)) {
          const query = lineBuffer.slice(AI_PREFIX.length).trim()
          lineBuffer = ''
          if (!query) {
            // Empty query — just send newline normally
            window.electronAPI.ssh.write(tab.channelId, data)
            return
          }

          aiPending = true
          // Clear the typed line: move to start, erase line
          term.write('\r\x1b[2K')
          term.write(`\x1b[90m⟳ AI: ${query}\x1b[0m`)

          window.electronAPI.ai.complete({ query, os: 'Linux' }).then((result) => {
            aiPending = false
            // Clear the AI status line
            term.write('\r\x1b[2K')
            if (result.error === 'NO_KEY') {
              term.write('\x1b[33m[AI] No API key set — use Ctrl+K to configure\x1b[0m\r\n')
              return
            }
            if (result.error) {
              term.write(`\x1b[31m[AI error] ${result.error}\x1b[0m\r\n`)
              return
            }
            if (result.type === 'text') {
              // For text answers, print them and return to prompt
              term.write(`\x1b[36m[AI] ${result.value}\x1b[0m\r\n`)
              return
            }
            const cmd = result.value
            // Type the command visibly into the terminal then execute it
            term.write(cmd)
            window.electronAPI.ssh.write(tab.channelId, cmd + '\r')
          })
          return
        }

        // Normal Enter — reset buffer and pass through
        lineBuffer = ''
        window.electronAPI.ssh.write(tab.channelId, data)
        return
      }

      // Ctrl+C / Ctrl+D etc. — reset buffer
      if (code < 32 && code !== 9) {
        lineBuffer = ''
        window.electronAPI.ssh.write(tab.channelId, data)
        return
      }

      // Accumulate printable characters
      lineBuffer += data

      // If the buffer starts with the AI prefix, echo locally (don't send to SSH yet)
      if (lineBuffer.startsWith(AI_PREFIX.slice(0, lineBuffer.length)) ||
          lineBuffer.startsWith(AI_PREFIX)) {
        term.write(data)
        return
      }

      // Not an AI command — flush buffer to SSH
      if (lineBuffer.length === data.length) {
        // First char didn't match prefix at all, send normally
        window.electronAPI.ssh.write(tab.channelId, data)
      } else {
        // We were buffering but it diverged — flush everything
        window.electronAPI.ssh.write(tab.channelId, lineBuffer)
      }
      lineBuffer = ''
    })

    // Strip ANSI escape codes for prompt parsing
    const stripAnsi = (s) => s
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b[()][0-9A-Z]/g, '')
    // Debounce cwd updates so rapid output doesn't thrash SFTP
    let cwdTimer = null

    // SSH data → terminal + line buffer
    const removeData = window.electronAPI.ssh.onData((channelId, data) => {
      if (channelId === tab.channelId) {
        term.write(colorizeRef.current ? colorizeOutput(data) : data)

        const plain = stripAnsi(data)

        // Accumulate into line buffer for filter
        const combined = pendingLineRef.current + plain
        const parts = combined.split('\n')
        pendingLineRef.current = parts.pop()
        let changed = false
        for (const line of parts) {
          const clean = line.replace(/\r/g, '').trim()
          if (clean) {
            outputLinesRef.current.push(clean)
            if (outputLinesRef.current.length > 5000) outputLinesRef.current.shift()
            changed = true
          }
        }
        // Update filter results if filter is active
        if (changed && filterTextRef.current) {
          const re = buildFilterRegex(filterTextRef.current)
          if (re) setFilterLines(outputLinesRef.current.filter((l) => re.test(l)))
        }

        // Detect cwd from prompt
        const m = plain.match(/(?:^|\r?\n|\r)[^\r\n]*[: ]([~/][^\r\n $#>]*?)\s*[$#>]\s*$/)
        if (m) {
          const detected = m[1].trim()
          if (detected) {
            clearTimeout(cwdTimer)
            cwdTimer = setTimeout(() => setCwd(detected), 300)
          }
        }
      }
    })

    const removeClose = window.electronAPI.ssh.onClose((channelId) => {
      if (channelId === tab.channelId) {
        term.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
        setConnected(false)
      }
    })

    const removeError = window.electronAPI.ssh.onError((channelId, message) => {
      if (channelId === tab.channelId) {
        setError(message)
        term.write('\r\n\x1b[31mError: ' + message + '\x1b[0m\r\n')
        setConnected(false)
      }
    })

    // Terminal resize → SSH
    const resizeObs = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        const { cols, rows } = term
        window.electronAPI.ssh.resize(tab.channelId, cols, rows)
      } catch (_) {}
    })
    if (termRef.current) {
      resizeObs.observe(termRef.current.parentElement)
    }

    cleanupRef.current = [
      () => inputDisposer.dispose(),
      removeData,
      removeClose,
      removeError,
      () => resizeObs.disconnect(),
      () => {
        window.electronAPI.ssh.disconnect(tab.channelId)
        term.dispose()
      },
    ]

    return () => {
      cleanupRef.current.forEach((fn) => { try { fn() } catch (_) {} })
    }
  }, [tab.channelId])

  // Refit when SFTP panel is toggled
  useEffect(() => {
    setTimeout(() => {
      try { fitAddonRef.current?.fit() } catch (_) {}
    }, 100)
  }, [showSftp])

  return (
    <div className="terminal-tab-root">
      <div className="terminal-toolbar">
        <span className="terminal-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : error ? 'Error' : 'Connecting...'}
        </span>
        <button
          className={`icon-btn ${showAi ? 'active' : ''}`}
          onClick={() => setShowAi((v) => !v)}
          title="AI command (Ctrl+K)"
        >
          <Sparkles size={16} />
        </button>
        <button
          className={`icon-btn ${colorize ? 'active' : ''}`}
          onClick={() => setColorize((v) => !v)}
          title="Toggle keyword colorization"
        >
          <Highlighter size={16} />
        </button>
        <button
          className={`icon-btn ${showFilter ? 'active' : ''}`}
          onClick={() => setShowFilter((v) => !v)}
          title="Filter output (Ctrl+F)"
        >
          <ListFilter size={16} />
        </button>
        <button
          className={`icon-btn ${showSftp ? 'active' : ''}`}
          onClick={() => setShowSftp((v) => !v)}
          title="Toggle SFTP panel"
        >
          <PanelRight size={16} />
        </button>
      </div>
      {showAi && (
        <AiBar
          onRun={(cmd) => window.electronAPI.ssh.write(tab.channelId, cmd)}
          onClose={() => setShowAi(false)}
          getSelection={() => terminalInstanceRef.current?.getSelection() || ''}
        />
      )}
      <div className="terminal-split">
        <div className="terminal-wrapper">
          <div ref={termRef} onContextMenu={handleContextMenu} />
          {showFilter && (
            <div className="filter-overlay">
              <div className="filter-bar">
                <ListFilter size={14} />
                <input
                  ref={filterInputRef}
                  className="filter-input"
                  placeholder="Filter output… (use | for OR)"
                  value={filterText}
                  onChange={(e) => {
                    const v = e.target.value
                    setFilterText(v)
                    filterTextRef.current = v
                    setActivePreset(null)
                    const re = buildFilterRegex(v)
                    setFilterLines(re ? outputLinesRef.current.filter((l) => re.test(l)) : [])
                  }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowFilter(false); setFilterText(''); setActivePreset(null) } }}
                />
                <span className="filter-count">{filterText ? `${filterLines.length} match${filterLines.length !== 1 ? 'es' : ''}` : ''}</span>
                <button className="icon-btn" onClick={() => { setShowFilter(false); setFilterText(''); setActivePreset(null) }} title="Close filter">✕</button>
              </div>
              <div className="filter-presets">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`filter-preset-chip ${activePreset === p.label ? 'active' : ''}`}
                    style={{ '--chip-color': p.color }}
                    onClick={() => {
                      if (activePreset === p.label) {
                        setActivePreset(null)
                        setFilterText('')
                        filterTextRef.current = ''
                        setFilterLines([])
                      } else {
                        setActivePreset(p.label)
                        setFilterText(p.pattern)
                        filterTextRef.current = p.pattern
                        const re = buildFilterRegex(p.pattern)
                        setFilterLines(re ? outputLinesRef.current.filter((l) => re.test(l)) : [])
                      }
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="filter-results" ref={filterResultsRef}>
                {!filterText ? (
                  <div className="filter-empty">Type to filter, or pick a preset above</div>
                ) : filterLines.length === 0 ? (
                  <div className="filter-empty">No matches</div>
                ) : filterLines.map((line, i) => {
                  const re = buildFilterRegex(filterText)
                  const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  const html = re ? safe.replace(re, (m) => `<mark class="filter-match">${m}</mark>`) : safe
                  return <div key={i} className="filter-line" dangerouslySetInnerHTML={{ __html: html }} />
                })}
              </div>
            </div>
          )}
        </div>
        {showSftp && connected && (
          <>
            <div
              className="split-divider"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = sftpWidth
                const onMove = (ev) => {
                  const delta = startX - ev.clientX
                  setSftpWidth(Math.max(200, Math.min(800, startW + delta)))
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  setTimeout(() => { try { fitAddonRef.current?.fit() } catch (_) {} }, 50)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            <SftpPanel channelId={tab.channelId} cwd={cwd} width={sftpWidth} />
          </>
        )}
      </div>

      {ctxMenu && (
        <div
          className="context-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={handleCopy} disabled={!ctxMenu.hasSelection}>Copy</button>
          <button onClick={handlePaste}>Paste</button>
        </div>
      )}
    </div>
  )
}
