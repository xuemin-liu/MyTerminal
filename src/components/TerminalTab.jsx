import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import {
  PanelRight, Highlighter, Sparkles, ListFilter, Search,
  Code2, SplitSquareHorizontal,
} from 'lucide-react'
import SftpPanel from './SftpPanel'
import AiBar from './AiBar'
import SnippetPanel from './SnippetPanel'
import SplitTerminalPane from './SplitTerminalPane'
import useSessionStore from '../store/useSessionStore'

const FILTER_PRESETS = [
  { label: 'Error',   color: '#ff7b72', pattern: 'error|errors|failed|failure|fatal|exception|traceback|critical' },
  { label: 'Warning', color: '#d29922', pattern: 'warning|warnings|warn|deprecated|caution' },
  { label: 'Info',    color: '#39c5cf', pattern: 'info|note|hint|notice' },
  { label: 'Success', color: '#3fb950', pattern: 'success|succeeded|done|ok|passed|complete|completed' },
]

function buildFilterRegex(text) {
  const parts = text.split('|').map((p) => p.trim().replace(/[.*+?^${}()[\]\\]/g, '\\$&')).filter(Boolean)
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

function colorizeOutput(text) {
  const parts = text.split(/(\x1b\[[0-9;]*m)/)
  let insideColor = false
  return parts.map((part) => {
    if (/^\x1b\[/.test(part)) {
      insideColor = part !== '\x1b[0m' && part !== '\x1b[m'
      return part
    }
    if (insideColor) return part
    return part
      .replace(/\b(error|errors|failed|failure|fatal|exception|traceback|critical)\b/gi, '\x1b[1;31m$1\x1b[0m')
      .replace(/\b(warning|warnings|warn|deprecated|caution)\b/gi, '\x1b[1;33m$1\x1b[0m')
      .replace(/\b(info|note|hint|notice)\b/gi, '\x1b[36m$1\x1b[0m')
      .replace(/\b(success|succeeded|done|ok|passed|complete|completed)\b/gi, '\x1b[32m$1\x1b[0m')
  }).join('')
}

const stripAnsi = (s) => s
  .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  .replace(/\x1b\][^\x07]*\x07/g, '')
  .replace(/\x1b[()][0-9A-Z]/g, '')

export default function TerminalTab({ tab, isActive }) {
  const termRef = useRef(null)
  const terminalInstanceRef = useRef(null)
  const fitAddonRef = useRef(null)
  const searchAddonRef = useRef(null)
  const cleanupRef = useRef([])

  // State
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const [showSftp, setShowSftp] = useState(false)
  const [cwd, setCwd] = useState(null)
  const [sftpWidth, setSftpWidth] = useState(380)
  const [showAi, setShowAi] = useState(false)
  const [colorize, setColorize] = useState(true)
  const [ctxMenu, setCtxMenu] = useState(null)
  const [showFilter, setShowFilter] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [filterLines, setFilterLines] = useState([])
  const [activePreset, setActivePreset] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [reconnectCountdown, setReconnectCountdown] = useState(null)
  const [showSnippets, setShowSnippets] = useState(false)

  // Refs for async-safe access
  const colorizeRef = useRef(true)
  const filterTextRef = useRef('')
  const showAiRef = useRef(false)
  const showSearchRef = useRef(false)
  const showFilterRef = useRef(false)
  const filterInputRef = useRef(null)
  const filterResultsRef = useRef(null)
  const searchInputRef = useRef(null)
  const outputLinesRef = useRef([])
  const pendingLineRef = useRef('')
  const reconnectTimerRef = useRef(null)
  const isMountedRef = useRef(true)
  const reconnectAttemptRef = useRef(0)

  const { addSplitPane, removeSplitPane } = useSessionStore()

  // Sync refs
  useEffect(() => { colorizeRef.current = colorize }, [colorize])
  useEffect(() => { filterTextRef.current = filterText }, [filterText])
  useEffect(() => { showAiRef.current = showAi }, [showAi])
  useEffect(() => { showSearchRef.current = showSearch }, [showSearch])
  useEffect(() => { showFilterRef.current = showFilter }, [showFilter])

  // Font size → update live terminal
  useEffect(() => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.options.fontSize = fontSize
      setTimeout(() => { try { fitAddonRef.current?.fit() } catch (_) {} }, 50)
    }
  }, [fontSize])

  // Auto-focus search input
  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [showSearch])

  // Auto-focus filter input
  useEffect(() => {
    if (showFilter) setTimeout(() => filterInputRef.current?.focus(), 50)
  }, [showFilter])

  // Re-run filter
  useEffect(() => {
    const re = buildFilterRegex(filterText)
    setFilterLines(re ? outputLinesRef.current.filter((l) => re.test(l)) : [])
  }, [filterText])

  // Scroll filter to bottom
  useEffect(() => {
    const el = filterResultsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filterLines])

  // Keyboard shortcuts — fallback for when xterm does NOT have focus (e.g. toolbar, search bar)
  // Primary handling (when xterm IS focused) is done via attachCustomKeyEventHandler below.
  useEffect(() => {
    if (!isActive) return
    const handler = (e) => {
      // Skip if xterm textarea has focus — attachCustomKeyEventHandler handles it there
      if (document.activeElement?.classList.contains('xterm-helper-textarea')) return
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setShowSearch((v) => !v) }
      if (e.ctrlKey && !e.shiftKey && e.key === 'k') { e.preventDefault(); setShowAi((v) => !v) }
      if (e.ctrlKey && !e.shiftKey && e.key === 'f') { e.preventDefault(); setShowFilter((v) => !v) }
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setFontSize((s) => Math.min(32, s + 1)) }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); setFontSize((s) => Math.max(8, s - 1)) }
      if (e.ctrlKey && e.key === '0') { e.preventDefault(); setFontSize(14) }
      if (e.key === 'Escape') { setShowAi(false); setShowSearch(false); setShowFilter(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive])

  // Context menu for copy/paste
  const handleContextMenu = (e) => {
    e.preventDefault()
    // Clamp so menu (≈120×70) doesn't overflow the window
    const x = Math.min(e.clientX, window.innerWidth - 130)
    const y = Math.min(e.clientY, window.innerHeight - 80)
    setCtxMenu({ x, y, hasSelection: !!terminalInstanceRef.current?.getSelection()?.length })
  }
  const handleCopy = () => {
    const sel = terminalInstanceRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel)
    setCtxMenu(null)
  }
  const handlePaste = async () => {
    const text = await navigator.clipboard.readText()
    if (text) writeToChannel(text)
    setCtxMenu(null)
  }

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  // Helper: write to the right channel type
  const writeToChannel = (data, channelId = tab.channelId) => {
    if (tab.isLocal) window.electronAPI.local.write(channelId, data)
    else window.electronAPI.ssh.write(channelId, data)
  }

  // Broadcast write
  const broadcastWrite = (data) => {
    const { broadcastMode, tabs } = useSessionStore.getState()
    if (broadcastMode) {
      tabs.forEach((t) => {
        if (t.isLocal) window.electronAPI.local.write(t.channelId, data)
        else window.electronAPI.ssh.write(t.channelId, data)
      })
    } else {
      writeToChannel(data)
    }
  }

  // Main terminal useEffect
  useEffect(() => {
    isMountedRef.current = true
    reconnectAttemptRef.current = 0

    const term = new Terminal({
      theme: {
        background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
        brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      bellStyle: 'sound',
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(searchAddon)

    terminalInstanceRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    term.open(termRef.current)
    fitAddon.fit()

    // Handle shortcuts before xterm sends them to the PTY/SSH channel.
    // Returning false prevents xterm from processing the key further.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'k') { setShowAi((v) => !v); return false }
        if (e.key === 'f') { setShowFilter((v) => !v); return false }
        if (e.key === '=' || e.key === '+') { setFontSize((s) => Math.min(32, s + 1)); return false }
        if (e.key === '-') { setFontSize((s) => Math.max(8, s - 1)); return false }
        if (e.key === '0') { setFontSize(14); return false }
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key === 'F') { setShowSearch((v) => !v); return false }
      if (e.key === 'Escape' && (showAiRef.current || showSearchRef.current || showFilterRef.current)) {
        setShowAi(false); setShowSearch(false); setShowFilter(false)
        return false
      }
      return true
    })

    // Reconnect logic
    const scheduleReconnect = () => {
      if (!isMountedRef.current || tab.isLocal) return
      // Guard: cancel any in-progress timer before starting a new one so that
      // multiple close/error events don't create parallel countdown loops.
      clearInterval(reconnectTimerRef.current)
      reconnectTimerRef.current = null
      const attempt = reconnectAttemptRef.current + 1
      if (attempt > 5) {
        term.write('\r\n\x1b[31m[Max reconnect attempts reached]\x1b[0m\r\n')
        return
      }
      reconnectAttemptRef.current = attempt
      let remaining = Math.min(30, attempt * 5)
      setReconnectCountdown(remaining)
      const tick = setInterval(() => {
        if (!isMountedRef.current) { clearInterval(tick); return }
        remaining--
        setReconnectCountdown(remaining > 0 ? remaining : null)
        if (remaining <= 0) { clearInterval(tick); connectSSH() }
      }, 1000)
      reconnectTimerRef.current = tick
    }

    const connectSSH = () => {
      if (!isMountedRef.current) return
      if (tab.isLocal) {
        const localLabel = tab.wslDistro ? `WSL: ${tab.wslDistro}` : 'local terminal'
        term.write(`\r\n\x1b[90mStarting ${localLabel}...\x1b[0m\r\n`)
        const spawnOpts = tab.wslDistro
          ? { shell: 'wsl.exe', args: ['-d', tab.wslDistro] }
          : {}
        window.electronAPI.local.spawn(tab.channelId, spawnOpts).then((result) => {
          if (!isMountedRef.current) return
          if (result?.error) { setError(result.error); term.write('\r\n\x1b[31mError: ' + result.error + '\x1b[0m\r\n'); return }
          setConnected(true)
          fitAddon.fit()
        })
      } else {
        term.write('\r\n\x1b[90mConnecting to ' + tab.config.host + '...\x1b[0m\r\n')
        window.electronAPI.ssh.connect(tab.channelId, tab.config).then((result) => {
          if (!isMountedRef.current) return
          if (result?.error) {
            setError(result.error)
            term.write('\r\n\x1b[31mError: ' + result.error + '\x1b[0m\r\n')
            scheduleReconnect()
            return
          }
          setConnected(true)
          reconnectAttemptRef.current = 0
          clearTimeout(reconnectTimerRef.current)
          setReconnectCountdown(null)
          fitAddon.fit()
          window.electronAPI.ssh.resize(tab.channelId, term.cols, term.rows)
        })
      }
    }

    connectSSH()

    // Font zoom via Ctrl+scroll
    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        setFontSize((s) => e.deltaY < 0 ? Math.min(32, s + 1) : Math.max(8, s - 1))
      }
    }
    const termContainer = termRef.current?.parentElement
    if (termContainer) termContainer.addEventListener('wheel', handleWheel, { passive: false })

    // AI inline mode
    const AI_PREFIX = '??'
    let lineBuffer = ''
    let aiPending = false

    const inputDisposer = term.onData((data) => {
      if (aiPending) return
      const code = data.charCodeAt(0)

      if (code === 127) {
        if (lineBuffer.length > 0) {
          lineBuffer = lineBuffer.slice(0, -1)
          if (lineBuffer.startsWith(AI_PREFIX.slice(0, lineBuffer.length)) || lineBuffer.startsWith(AI_PREFIX)) {
            term.write('\b \b')
            return
          }
        }
        broadcastWrite(data)
        return
      }

      if (data === '\r') {
        if (lineBuffer.startsWith(AI_PREFIX)) {
          const query = lineBuffer.slice(AI_PREFIX.length).trim()
          lineBuffer = ''
          if (!query) { broadcastWrite(data); return }
          aiPending = true
          term.write('\r\x1b[2K')
          term.write(`\x1b[90m⟳ AI: ${query}\x1b[0m`)
          const osHint = tab.wslDistro
            ? `Linux (WSL: ${tab.wslDistro})`
            : tab.isLocal && window.electronAPI.platform === 'win32' ? 'Windows PowerShell' : 'Linux'
          window.electronAPI.ai.complete({ query, os: osHint }).then((result) => {
            aiPending = false
            term.write('\r\x1b[2K')
            if (result.error === 'NO_KEY') { term.write('\x1b[33m[AI] No API key set — use Ctrl+K\x1b[0m\r\n'); return }
            if (result.error) { term.write(`\x1b[31m[AI error] ${result.error}\x1b[0m\r\n`); return }
            if (result.type === 'text') { term.write(`\x1b[36m[AI] ${result.value}\x1b[0m\r\n`); return }
            term.write(result.value)
            broadcastWrite(result.value + '\r')
          })
          return
        }
        // Erase any locally-echoed partial prefix before sending Enter
        if (lineBuffer.length > 0) term.write('\b \b'.repeat(lineBuffer.length))
        lineBuffer = ''
        broadcastWrite(data)
        return
      }

      if (code < 32 && code !== 9) {
        // Erase any chars that were locally echoed as part of a partial prefix
        if (lineBuffer.length > 0) term.write('\b \b'.repeat(lineBuffer.length))
        lineBuffer = ''
        broadcastWrite(data)
        return
      }

      lineBuffer += data
      if (lineBuffer.startsWith(AI_PREFIX.slice(0, lineBuffer.length)) || lineBuffer.startsWith(AI_PREFIX)) {
        term.write(data); return
      }
      // Erase chars that were locally echoed as part of the partial prefix
      // so SSH's echo doesn't double-display them
      const prevEchoed = lineBuffer.length - data.length
      if (prevEchoed > 0) term.write('\b \b'.repeat(prevEchoed))
      if (lineBuffer.length === data.length) broadcastWrite(data)
      else broadcastWrite(lineBuffer)
      lineBuffer = ''
    })

    // SSH/local data → terminal
    let cwdTimer = null
    const removeData = window.electronAPI.ssh.onData((channelId, data) => {
      if (channelId !== tab.channelId) return

      if (data.includes('\x07')) {
        window.electronAPI.notify.send('Terminal Bell', `Activity in: ${tab.label}`)
      }

      term.write(colorizeRef.current ? colorizeOutput(data) : data)

      const plain = stripAnsi(data)

      // Line buffer for filter
      const combined = pendingLineRef.current + plain
      const parts = combined.split('\n')
      pendingLineRef.current = parts.pop()
      let changed = false
      for (const line of parts) {
        const clean = line.replace(/\r/g, '').trim()
        if (clean) {
          outputLinesRef.current.push(clean)
          if (outputLinesRef.current.length > 5000) outputLinesRef.current.splice(0, 500)
          changed = true
        }
      }
      if (changed && filterTextRef.current) {
        const re = buildFilterRegex(filterTextRef.current)
        if (re) setFilterLines(outputLinesRef.current.filter((l) => re.test(l)))
      }

      // CWD detection — prefer OSC 7 (shell integration), fall back to prompt regex
      // Enable in shell: printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"  (bash/zsh)
      const osc7 = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]*)(?:\x07|\x1b\\)/)
      if (osc7) {
        const detected = decodeURIComponent(osc7[1])
        if (detected) { clearTimeout(cwdTimer); cwdTimer = setTimeout(() => setCwd(detected), 300) }
      } else {
        const m = plain.match(/(?:^|\r?\n|\r)[^\r\n]*[: ]([~/][^\r\n $#>]*?)\s*[$#>]\s*$/)
        if (m) {
          const detected = m[1].trim()
          if (detected) { clearTimeout(cwdTimer); cwdTimer = setTimeout(() => setCwd(detected), 300) }
        }
      }
    })

    const removeClose = window.electronAPI.ssh.onClose((channelId) => {
      if (channelId === tab.channelId) {
        term.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
        setConnected(false)
        scheduleReconnect()
      }
    })

    const removeError = window.electronAPI.ssh.onError((channelId, message) => {
      if (channelId === tab.channelId) {
        setError(message)
        term.write('\r\n\x1b[31mError: ' + message + '\x1b[0m\r\n')
        setConnected(false)
      }
    })

    const resizeObs = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        const { cols, rows } = term
        if (tab.isLocal) window.electronAPI.local.resize(tab.channelId, cols, rows)
        else window.electronAPI.ssh.resize(tab.channelId, cols, rows)
      } catch (_) {}
    })
    if (termRef.current) resizeObs.observe(termRef.current.parentElement)

    cleanupRef.current = [
      () => inputDisposer.dispose(),
      removeData, removeClose, removeError,
      () => resizeObs.disconnect(),
      () => { if (termContainer) termContainer.removeEventListener('wheel', handleWheel) },
      () => clearInterval(reconnectTimerRef.current),
      () => {
        isMountedRef.current = false
        if (tab.isLocal) window.electronAPI.local.disconnect(tab.channelId)
        else window.electronAPI.ssh.disconnect(tab.channelId)
        term.dispose()
      },
    ]

    return () => cleanupRef.current.forEach((fn) => { try { fn() } catch (_) {} })
  }, [tab.channelId])

  // Refit when panels toggle
  useEffect(() => {
    setTimeout(() => { try { fitAddonRef.current?.fit() } catch (_) {} }, 100)
  }, [showSftp, showSnippets])

  const doSearch = (direction = 'next') => {
    if (!searchQuery) return
    const opts = { caseSensitive, wholeWord }
    if (direction === 'next') searchAddonRef.current?.findNext(searchQuery, opts)
    else searchAddonRef.current?.findPrevious(searchQuery, opts)
  }

  const applyFilter = (text) => {
    setFilterText(text)
    filterTextRef.current = text
    const re = buildFilterRegex(text)
    setFilterLines(re ? outputLinesRef.current.filter((l) => re.test(l)) : [])
  }

  return (
    <div className="terminal-tab-root">
      {/* Toolbar */}
      <div className="terminal-toolbar">
        <span className="terminal-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : error ? 'Error' : 'Connecting...'}
        </span>

        {reconnectCountdown !== null && (
          <span className="reconnect-badge">
            Reconnecting in {reconnectCountdown}s…
            <button onClick={() => { clearInterval(reconnectTimerRef.current); setReconnectCountdown(null) }}>Cancel</button>
          </span>
        )}

        <button className={`icon-btn ${showAi ? 'active' : ''}`} onClick={() => setShowAi((v) => !v)} title="AI assistant (Ctrl+K)">
          <Sparkles size={16} />
        </button>
        <button className={`icon-btn ${showSearch ? 'active' : ''}`} onClick={() => setShowSearch((v) => !v)} title="Search terminal (Ctrl+Shift+F)">
          <Search size={16} />
        </button>
        <button className={`icon-btn ${showFilter ? 'active' : ''}`} onClick={() => setShowFilter((v) => !v)} title="Filter output (Ctrl+F)">
          <ListFilter size={16} />
        </button>
        <button className={`icon-btn ${colorize ? 'active' : ''}`} onClick={() => setColorize((v) => !v)} title="Toggle keyword colorization">
          <Highlighter size={16} />
        </button>
        <button className={`icon-btn ${showSnippets ? 'active' : ''}`} onClick={() => setShowSnippets((v) => !v)} title="Snippets">
          <Code2 size={16} />
        </button>
        {!tab.isLocal && (
          <>
            <button
              className={`icon-btn ${tab.splitChannelId ? 'active' : ''}`}
              onClick={() => tab.splitChannelId ? removeSplitPane(tab.id) : addSplitPane(tab.id)}
              title="Split pane"
            >
              <SplitSquareHorizontal size={16} />
            </button>
            <button className={`icon-btn ${showSftp ? 'active' : ''}`} onClick={() => setShowSftp((v) => !v)} title="Toggle SFTP panel">
              <PanelRight size={16} />
            </button>
          </>
        )}
      </div>

      {/* AI bar */}
      {showAi && (
        <AiBar
          onRun={(cmd) => writeToChannel(cmd)}
          onClose={() => setShowAi(false)}
          getSelection={() => terminalInstanceRef.current?.getSelection() || ''}
          getRecentOutput={() => outputLinesRef.current.slice(-150).join('\n')}
          osHint={
            tab.wslDistro
              ? `Linux (WSL: ${tab.wslDistro})`
              : tab.isLocal && window.electronAPI.platform === 'win32' ? 'Windows PowerShell' : 'Linux'
          }
        />
      )}

      {/* xterm Search bar */}
      {showSearch && (
        <div className="search-bar">
          <Search size={13} />
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder="Search terminal…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch(e.shiftKey ? 'prev' : 'next')
              if (e.key === 'Escape') { setShowSearch(false); searchAddonRef.current?.clearDecorations() }
            }}
          />
          <label title="Case sensitive"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Aa</label>
          <label title="Whole word"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> W</label>
          <button onClick={() => doSearch('prev')} title="Previous">↑</button>
          <button onClick={() => doSearch('next')} title="Next">↓</button>
          <button onClick={() => { setShowSearch(false); searchAddonRef.current?.clearDecorations() }}>✕</button>
        </div>
      )}

      {/* Snippets panel */}
      {showSnippets && (
        <SnippetPanel
          onInsert={(cmd) => { writeToChannel(cmd + '\r') }}
          onClose={() => setShowSnippets(false)}
        />
      )}

      {/* Terminal split area */}
      <div className="terminal-split">
        <div className="terminal-wrapper">
          <div ref={termRef} onContextMenu={handleContextMenu} />

          {/* Filter overlay */}
          {showFilter && (
            <div className="filter-overlay">
              <div className="filter-bar">
                <ListFilter size={14} />
                <input
                  ref={filterInputRef}
                  className="filter-input"
                  placeholder="Filter output… (use | for OR)"
                  value={filterText}
                  onChange={(e) => { setActivePreset(null); applyFilter(e.target.value) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowFilter(false); applyFilter(''); setActivePreset(null) } }}
                />
                <span className="filter-count">{filterText ? `${filterLines.length} match${filterLines.length !== 1 ? 'es' : ''}` : ''}</span>
                <button className="icon-btn" onClick={() => { setShowFilter(false); applyFilter(''); setActivePreset(null) }}>✕</button>
              </div>
              <div className="filter-presets">
                {FILTER_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className={`filter-preset-chip ${activePreset === p.label ? 'active' : ''}`}
                    style={{ '--chip-color': p.color }}
                    onClick={() => {
                      if (activePreset === p.label) { setActivePreset(null); applyFilter('') }
                      else { setActivePreset(p.label); applyFilter(p.pattern) }
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

        {/* Split pane */}
        {tab.splitChannelId && tab.splitConfig && (
          <>
            <div
              className="split-divider"
              onMouseDown={(e) => {
                e.preventDefault()
                const container = e.currentTarget.parentElement
                const totalW = container.offsetWidth
                const onMove = (ev) => {
                  const ratio = Math.max(0.2, Math.min(0.8, (ev.clientX - container.getBoundingClientRect().left) / totalW))
                  container.children[0].style.flex = ratio
                  container.children[2].style.flex = 1 - ratio
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
            <div className="terminal-wrapper" style={{ flex: 1 }}>
              <SplitTerminalPane
                key={tab.splitChannelId}
                channelId={tab.splitChannelId}
                config={tab.splitConfig}
                onClose={() => removeSplitPane(tab.id)}
              />
            </div>
          </>
        )}

        {/* SFTP panel */}
        {showSftp && connected && !tab.isLocal && (
          <>
            <div
              className="split-divider"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = sftpWidth
                const onMove = (ev) => setSftpWidth(Math.max(200, Math.min(800, startW + (startX - ev.clientX))))
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  setTimeout(() => { try { fitAddonRef.current?.fit() } catch (_) {} }, 50)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            <SftpPanel
              channelId={tab.channelId}
              cwd={cwd}
              width={sftpWidth}
              sessionKey={tab.config ? `${tab.config.host}:${tab.config.port || 22}` : tab.channelId}
            />
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="context-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={handleCopy} disabled={!ctxMenu.hasSelection}>Copy</button>
          <button onClick={handlePaste}>Paste</button>
        </div>
      )}
    </div>
  )
}
