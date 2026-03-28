import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import {
  PanelRight, Highlighter, Sparkles, ListFilter, Search,
  Code2, SplitSquareHorizontal, Regex, Copy, Check, Bookmark,
  FileText, Download, Network,
} from 'lucide-react'
import SftpPanel from './SftpPanel'
import AiBar from './AiBar'
import SnippetPanel from './SnippetPanel'
import SplitTerminalPane from './SplitTerminalPane'
import TunnelPanel from './TunnelPanel'
import FileEditor from './FileEditor'
import useSessionStore from '../store/useSessionStore'
import { FILTER_PRESETS, parseFilter, matchesFilter, colorizeOutput, stripAnsi } from '../utils/terminalUtils'

export default function TerminalTab({ tab, isActive }) {
  const { addSplitPane, removeSplitPane, settings } = useSessionStore()

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
  const [colorize, setColorize] = useState(settings.colorizeByDefault)
  const [ctxMenu, setCtxMenu] = useState(null)
  const [showFilter, setShowFilter] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [filterLines, setFilterLines] = useState([])
  const [activePreset, setActivePreset] = useState(null)
  const [isRegexMode, setIsRegexMode] = useState(false)
  const [regexError, setRegexError] = useState(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [customPresets, setCustomPresets] = useState([])
  const [ctrlCDialog, setCtrlCDialog] = useState(null) // null | { hasSelection: boolean }
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [fontSize, setFontSize] = useState(settings.defaultFontSize || 14)
  const [reconnectCountdown, setReconnectCountdown] = useState(null)
  const [showSnippets, setShowSnippets] = useState(false)
  const [stickyCmd, setStickyCmd] = useState(null) // { text, line } or null
  const [showStickyCmd, setShowStickyCmd] = useState(false)
  const [latency, setLatency] = useState(null)
  const [logging, setLogging] = useState(false)
  const [showTunnels, setShowTunnels] = useState(false)
  const [editingFile, setEditingFile] = useState(null)

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
  const isRegexModeRef = useRef(false)
  const lastBellRef = useRef(0)
  const stickyCmdRef = useRef(null)
  const loggingRef = useRef(false)

  // Sync refs
  useEffect(() => { colorizeRef.current = colorize }, [colorize])
  useEffect(() => { filterTextRef.current = filterText }, [filterText])
  useEffect(() => { showAiRef.current = showAi }, [showAi])
  useEffect(() => { showSearchRef.current = showSearch }, [showSearch])
  useEffect(() => { showFilterRef.current = showFilter }, [showFilter])
  useEffect(() => { isRegexModeRef.current = isRegexMode }, [isRegexMode])
  useEffect(() => { loggingRef.current = logging }, [logging])

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
    const { includeRe, excludeRe, error } = parseFilter(filterText, isRegexMode)
    setRegexError(error)
    setFilterLines(filterText.trim() ? outputLinesRef.current.filter((l) => matchesFilter(l, includeRe, excludeRe)) : [])
  }, [filterText, isRegexMode])

  // Scroll filter to bottom
  useEffect(() => {
    const el = filterResultsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filterLines])

  // Latency polling for SSH connections
  useEffect(() => {
    if (tab.isLocal || !connected) { setLatency(null); return }
    let active = true
    const poll = async () => {
      if (!active) return
      const ms = await window.electronAPI.ssh.ping(tab.channelId)
      if (active) setLatency(ms >= 0 ? ms : null)
    }
    poll()
    const timer = setInterval(poll, 30000)
    return () => { active = false; clearInterval(timer) }
  }, [tab.isLocal, connected, tab.channelId])

  // Load custom presets on mount
  useEffect(() => {
    window.electronAPI.filterPresets.getAll().then((p) => setCustomPresets(p || []))
  }, [])

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

  const handleCtrlCCopy = () => {
    const sel = terminalInstanceRef.current?.getSelection()
    if (sel) navigator.clipboard.writeText(sel)
    setCtrlCDialog(null)
  }
  const handleCtrlCBreak = () => {
    writeToChannel('\x03')
    setCtrlCDialog(null)
  }

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
      fontSize: settings.defaultFontSize || 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: settings.defaultScrollback || 10000,
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

    // Sticky command overlay: track scroll to show/hide
    const checkStickyVisibility = () => {
      const cmd = stickyCmdRef.current
      if (!cmd) { setShowStickyCmd(false); return }
      const viewportTop = term.buffer.active.viewportY
      const viewportBottom = viewportTop + term.rows - 1
      const isVisible = cmd.line >= viewportTop && cmd.line <= viewportBottom
      setShowStickyCmd(!isVisible)
    }
    const scrollDisposer = term.onScroll(() => checkStickyVisibility())
    const xtermViewport = termRef.current.querySelector('.xterm-viewport')
    const handleViewportScroll = () => checkStickyVisibility()
    if (xtermViewport) xtermViewport.addEventListener('scroll', handleViewportScroll)

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
        if (e.key === 'c') {
          const isLinux = !tab.isLocal || !!tab.wslDistro || window.electronAPI.platform !== 'win32'
          if (isLinux && !!term.getSelection()) {
            setCtrlCDialog({ hasSelection: true })
            return false
          }
        }
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

    const autoStartLogging = () => {
      if (settings.loggingEnabled && !loggingRef.current) {
        const logDir = settings.logDirectory || ''
        window.electronAPI.logging.start(tab.channelId, logDir).then((res) => {
          if (res?.success) { setLogging(true) }
        })
      }
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
          autoStartLogging()
          fitAddon.fit()
        })
      } else {
        term.write('\r\n\x1b[90mConnecting to ' + tab.config.host + '...\x1b[0m\r\n')
        const connConfig = { ...tab.config, keepaliveInterval: settings.keepaliveInterval || 10000 }
        window.electronAPI.ssh.connect(tab.channelId, connConfig).then((result) => {
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
          autoStartLogging()
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
        // Capture the current line for sticky command overlay
        const curLine = term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY)
        if (curLine) {
          const raw = curLine.translateToString().trim()
          // Strip common prompt prefixes (e.g. "user@host:~$", "$ ", "# ")
          const cmdText = raw.replace(/^.*?[$#>]\s*/, '')
          if (cmdText && cmdText.length > 0) {
            const cmdObj = { text: cmdText, line: term.buffer.active.baseY + term.buffer.active.cursorY }
            setStickyCmd(cmdObj)
            stickyCmdRef.current = cmdObj
            setShowStickyCmd(false)
          }
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

      if (data.includes('\x07') && !document.hasFocus()) {
        const now = Date.now()
        if (now - lastBellRef.current > 5000) {
          lastBellRef.current = now
          window.electronAPI.notify.send('Terminal Bell', `Activity in: ${tab.label}`)
        }
      }

      term.write(colorizeRef.current ? colorizeOutput(data) : data)

      // Session logging — fire-and-forget
      if (loggingRef.current) {
        window.electronAPI.logging.write(tab.channelId, stripAnsi(data))
      }

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
        const { includeRe, excludeRe } = parseFilter(filterTextRef.current, isRegexModeRef.current)
        if (includeRe || excludeRe) setFilterLines(outputLinesRef.current.filter((l) => matchesFilter(l, includeRe, excludeRe)))
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
        // Tear down any tunnels tied to this channel — the SSH client
        // they depend on is gone, so ports/forwards would be stale.
        window.electronAPI.tunnel.stopByChannel(tab.channelId)
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
      () => scrollDisposer.dispose(),
      () => { if (xtermViewport) xtermViewport.removeEventListener('scroll', handleViewportScroll) },
      removeData, removeClose, removeError,
      () => resizeObs.disconnect(),
      () => { if (termContainer) termContainer.removeEventListener('wheel', handleWheel) },
      () => clearInterval(reconnectTimerRef.current),
      () => {
        isMountedRef.current = false
        if (loggingRef.current) window.electronAPI.logging.stop(tab.channelId)
        window.electronAPI.tunnel.stopByChannel(tab.channelId)
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
  }, [showSftp, showSnippets, showTunnels])

  const doSearch = (direction = 'next') => {
    if (!searchQuery) return
    const opts = { caseSensitive, wholeWord }
    if (direction === 'next') searchAddonRef.current?.findNext(searchQuery, opts)
    else searchAddonRef.current?.findPrevious(searchQuery, opts)
  }

  const applyFilter = (text) => {
    setFilterText(text)
    filterTextRef.current = text
    const { includeRe, excludeRe, error } = parseFilter(text, isRegexModeRef.current)
    setRegexError(error)
    setFilterLines(text.trim() ? outputLinesRef.current.filter((l) => matchesFilter(l, includeRe, excludeRe)) : [])
  }

  const handleSavePreset = async () => {
    if (!filterText.trim() || customPresets.length >= 10) return
    const newPreset = { id: crypto.randomUUID(), label: filterText.trim().slice(0, 24), pattern: filterText.trim(), color: '#8b949e' }
    setCustomPresets(await window.electronAPI.filterPresets.save(newPreset))
  }

  const handleDeletePreset = async (id) => {
    setCustomPresets(await window.electronAPI.filterPresets.delete(id))
    if (activePreset === id) { setActivePreset(null); applyFilter('') }
  }

  const toggleLogging = async () => {
    if (logging) {
      await window.electronAPI.logging.stop(tab.channelId)
      setLogging(false)
    } else {
      const logDir = settings.logDirectory || ''
      const result = await window.electronAPI.logging.start(tab.channelId, logDir)
      if (result?.success) setLogging(true)
    }
  }

  const handleExport = async () => {
    const content = outputLinesRef.current.join('\n')
    await window.electronAPI.logging.export(content)
  }

  const handleEditFile = async (remotePath) => {
    const content = await window.electronAPI.sftp.readFile(tab.channelId, remotePath)
    if (content?.error) {
      // Show error to user for binary/size rejections
      if (terminalInstanceRef.current) {
        terminalInstanceRef.current.write(`\r\n\x1b[33m[Editor] ${content.error}\x1b[0m\r\n`)
      }
      return
    }
    setEditingFile({ remotePath, content, original: content })
  }

  const handleSaveFile = async () => {
    if (!editingFile) return
    const result = await window.electronAPI.sftp.writeFile(tab.channelId, editingFile.remotePath, editingFile.content)
    if (result?.error) return
    setEditingFile((prev) => prev ? { ...prev, original: prev.content } : null)
  }

  const handleCloseEditor = () => {
    if (editingFile && editingFile.content !== editingFile.original) {
      if (!confirm('You have unsaved changes. Discard them?')) return
    }
    setEditingFile(null)
  }

  const handleCopyMatches = () => {
    if (!filterLines.length) return
    navigator.clipboard.writeText(filterLines.join('\n'))
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 1500)
  }

  return (
    <div className="terminal-tab-root">
      {/* Toolbar */}
      <div className="terminal-toolbar">
        <span className="terminal-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Connected' : error ? 'Error' : 'Connecting...'}
        </span>

        {latency !== null && (
          <span className={`latency-badge ${latency < 100 ? 'good' : latency < 500 ? 'warn' : 'bad'}`}>
            {latency}ms
          </span>
        )}

        {reconnectCountdown !== null && (
          <span className="reconnect-badge">
            Reconnecting in {reconnectCountdown}s…
            <button onClick={() => { clearInterval(reconnectTimerRef.current); setReconnectCountdown(null) }}>Cancel</button>
          </span>
        )}

        <div className="terminal-toolbar-actions">
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
          <button className={`icon-btn ${logging ? 'active' : ''}`} onClick={toggleLogging} title={logging ? 'Stop logging' : 'Start logging'}>
            <FileText size={16} />
          </button>
          <button className="icon-btn" onClick={handleExport} title="Export terminal output">
            <Download size={16} />
          </button>
          <button className={`icon-btn ${showSnippets ? 'active' : ''}`} onClick={() => setShowSnippets((v) => !v)} title="Snippets">
            <Code2 size={16} />
          </button>
          {!tab.isLocal && (
            <>
              <button
                className={`icon-btn ${showTunnels ? 'active' : ''}`}
                onClick={() => setShowTunnels((v) => !v)}
                title="Port forwarding"
              >
                <Network size={16} />
              </button>
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

      {/* Tunnel panel */}
      {showTunnels && !tab.isLocal && connected && (
        <TunnelPanel
          channelId={tab.channelId}
          sessionId={tab.sessionId || tab.channelId}
          onClose={() => setShowTunnels(false)}
        />
      )}

      {/* Terminal split area */}
      <div className="terminal-split">
        <div className="terminal-wrapper">
          <div ref={termRef} onContextMenu={handleContextMenu} />

          {/* Sticky command overlay */}
          {showStickyCmd && stickyCmd && (
            <div className="sticky-cmd-overlay" onClick={() => {
              terminalInstanceRef.current?.scrollToLine(stickyCmd.line)
            }}>
              <span className="sticky-cmd-text">{stickyCmd.text}</span>
            </div>
          )}

          {/* Filter overlay */}
          {showFilter && (
            <div className="filter-overlay">
              <div className="filter-bar">
                <ListFilter size={14} />
                <input
                  ref={filterInputRef}
                  className={`filter-input${regexError ? ' filter-input-error' : ''}`}
                  placeholder={isRegexMode ? 'Regex filter… (use | for OR, -pattern to exclude)' : 'Filter… (use | for OR, -pattern or !pattern to exclude)'}
                  value={filterText}
                  onChange={(e) => { setActivePreset(null); applyFilter(e.target.value) }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowFilter(false); applyFilter(''); setActivePreset(null) } }}
                />
                {regexError && <span className="filter-regex-error" title={regexError}>!</span>}
                <span className="filter-count">{filterText ? `${filterLines.length} match${filterLines.length !== 1 ? 'es' : ''}` : ''}</span>
                <button
                  className={`icon-btn${isRegexMode ? ' active' : ''}`}
                  title="Regex mode"
                  onClick={() => setIsRegexMode((v) => !v)}
                >
                  <Regex size={14} />
                </button>
                <button
                  className="icon-btn"
                  title="Copy matched lines"
                  onClick={handleCopyMatches}
                  disabled={!filterLines.length}
                >
                  {copyFeedback ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  className="icon-btn"
                  title="Save as preset"
                  onClick={handleSavePreset}
                  disabled={!filterText.trim() || customPresets.length >= 10}
                >
                  <Bookmark size={14} />
                </button>
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
                {customPresets.map((p) => (
                  <span key={p.id} className="filter-preset-chip-wrapper" style={{ '--chip-color': p.color }}>
                    <button
                      className={`filter-preset-chip ${activePreset === p.id ? 'active' : ''}`}
                      style={{ '--chip-color': p.color }}
                      onClick={() => {
                        if (activePreset === p.id) { setActivePreset(null); applyFilter('') }
                        else { setActivePreset(p.id); applyFilter(p.pattern) }
                      }}
                    >
                      {p.label}
                    </button>
                    <button className="filter-preset-delete" onClick={() => handleDeletePreset(p.id)} title="Delete preset">×</button>
                  </span>
                ))}
              </div>
              <div className="filter-results" ref={filterResultsRef}>
                {regexError ? (
                  <div className="filter-empty" style={{ color: 'var(--danger)' }}>Invalid regex: {regexError}</div>
                ) : !filterText ? (
                  <div className="filter-empty">Type to filter, or pick a preset above</div>
                ) : filterLines.length === 0 ? (
                  <div className="filter-empty">No matches</div>
                ) : filterLines.map((line, i) => {
                  const { includeRe } = parseFilter(filterText, isRegexMode)
                  const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  const html = includeRe ? safe.replace(includeRe, (m) => `<mark class="filter-match">${m}</mark>`) : safe
                  return <div key={i} className="filter-line" dangerouslySetInnerHTML={{ __html: html }} />
                })}
              </div>
            </div>
          )}

          {/* Ctrl+C dialog */}
          {ctrlCDialog && (
            <div className="ctrlc-backdrop" onClick={handleCtrlCBreak}>
              <div className="ctrlc-dialog" onClick={(e) => e.stopPropagation()}>
                <span className="ctrlc-label">Ctrl+C — Copy or Break?</span>
                <div className="ctrlc-buttons">
                  <button autoFocus className="ctrlc-btn primary" onClick={handleCtrlCCopy}>Copy</button>
                  <button className="ctrlc-btn" onClick={handleCtrlCBreak}>Break</button>
                </div>
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
              onEditFile={handleEditFile}
            />
          </>
        )}
      </div>

      {/* Remote file editor overlay */}
      {editingFile && (
        <FileEditor
          editingFile={editingFile}
          onSave={handleSaveFile}
          onClose={handleCloseEditor}
          onChange={(value) => setEditingFile((prev) => prev ? { ...prev, content: value } : null)}
        />
      )}

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
