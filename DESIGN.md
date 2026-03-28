# MyTerminal — Design Document

## Overview

MyTerminal is a cross-platform desktop terminal manager built with Electron, inspired by MobaXterm. It provides SSH session management, local/WSL terminals, SFTP file browsing, port forwarding, and an AI assistant — all in a tabbed interface with a dark theme.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 33 + electron-vite |
| UI | React 18 + Zustand 5 |
| Terminal | @xterm/xterm 6 (FitAddon, SearchAddon, WebLinksAddon) |
| SSH/SFTP | ssh2 (CJS) |
| Local PTY | node-pty |
| Persistence | electron-store v8 (CJS) |
| Icons | lucide-react |
| AI | Anthropic SDK (Claude) |
| Build | Vite 5, electron-builder |
| Tests | Vitest |

## Directory Structure

```
electron/
  main.js              Main process — window, core IPC, AI
  preload.js           Context bridge (contextIsolation + sandbox)
  ssh-manager.js       SSH/SFTP connection lifecycle (singleton)
  local-terminal.js    Local/WSL PTY management (singleton)
  tunnel-manager.js    Port forwarding — local/remote/dynamic SOCKS5
  ipc/
    sessions.js        Session CRUD, import/export, SSH config import
    logging.js         Session logging (file write streams)
    tunnels.js         Tunnel start/stop/list IPC handlers

src/
  index.html           Renderer entry point
  main.jsx             React mount
  App.jsx              Root layout — TitleBar + Sidebar + TabBar + TerminalTab
  index.css            Global dark theme styles
  store/
    useSessionStore.js Zustand store — sessions, tabs, settings, workspace
  components/
    TitleBar.jsx       Custom frameless title bar with window controls
    Sidebar.jsx        Session list with search, groups, quick connect, SSH config import
    TabBar.jsx         Draggable tab bar with reorder support
    TerminalTab.jsx    Main terminal view — xterm, toolbar, panels, connection lifecycle
    SessionDialog.jsx  Create/edit session form (SSH config, jump host, auth)
    SettingsDialog.jsx Preferences — font, scrollback, colorize, keepalive, logging
    SftpPanel.jsx      SFTP file browser with favorites, upload/download/rename/delete
    FileEditor.jsx     Remote file editor overlay (read via SFTP, edit, save back)
    AiBar.jsx          AI assistant bar (Claude-powered command suggestions)
    SnippetPanel.jsx   Saved command snippets, insert into terminal
    SplitTerminalPane.jsx  Horizontal split pane (second terminal in same tab)
    TunnelPanel.jsx    Port forwarding UI — add/remove/start/stop tunnels
  utils/
    terminalUtils.js   Filter parsing, ANSI strip, keyword colorization

tests/
  terminalUtils.test.js  Filter, colorize, stripAnsi tests
  ipcValidation.test.js  Input validation helper tests
```

## Architecture

### Process Model

```
┌─────────────────────────────────────────────┐
│  Main Process (electron/main.js)            │
│                                             │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ SshManager   │  │ LocalTerminalManager │  │
│  │ (ssh2)       │  │ (node-pty)           │  │
│  └──────┬──────┘  └──────────┬───────────┘  │
│         │                    │               │
│  ┌──────┴──────┐  ┌─────────┴────────────┐  │
│  │ TunnelMgr   │  │ electron-store       │  │
│  │ (net/socks5) │  │ (sessions, settings) │  │
│  └─────────────┘  └──────────────────────┘  │
│         │                                    │
│     IPC (validated)                          │
│         │                                    │
├─────────┼────────────────────────────────────┤
│  Preload (contextBridge, sandbox: true)      │
├─────────┼────────────────────────────────────┤
│  Renderer Process                            │
│                                             │
│  ┌──────┴──────────────────────────────────┐ │
│  │ React App                               │ │
│  │  Zustand Store ←→ Components ←→ xterm   │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### Security

- **sandbox: true** on BrowserWindow — renderer runs in sandboxed mode
- **contextIsolation: true** — no direct Node access from renderer
- **IPC validation** — all critical handlers validate input types (`assertString`, `assertInt`, `assertPlainObject`)
- **Credential encryption** — passwords/passphrases encrypted via `safeStorage` (OS keychain)
- **Settings whitelist** — `settings:set` only accepts known keys
- **File editor guardrails** — 2 MB size limit, binary detection, unsaved-changes prompt

### Data Flow

**SSH Connection:**
1. User double-clicks session in Sidebar → `openTab()` in Zustand store
2. TerminalTab mounts → creates xterm Terminal + FitAddon
3. Calls `ssh:connect(channelId, config)` via IPC
4. SshManager creates ssh2 Client → opens shell stream
5. Shell data flows: `stream.on('data')` → `ssh:data` IPC → `term.write()`
6. User input flows: `term.onData()` → `ssh:write` IPC → `stream.write()`

**Local Terminal:**
1. Same tab lifecycle, but calls `local:spawn(channelId, options)`
2. LocalTerminalManager spawns node-pty process
3. Shell path resolved via `_resolveShell()` — searches PATH + System32 fallbacks with PATHEXT probing

### Persistence (electron-store)

| Store Key | Contents |
|-----------|----------|
| `sessions` | Saved SSH session configs (encrypted passwords) |
| `snippets` | Command snippets |
| `settings-prefs` | User preferences (font, scrollback, keepalive, etc.) |
| `sftp-favorites` | Per-session SFTP bookmarked paths |
| `filter-presets` | Custom output filter presets |
| `tunnel-configs.{sessionId}` | Per-session port forwarding configs |
| `workspace` | Open tabs + active tab (restored on restart) |
| `settings.anthropicApiKey` | Encrypted API key for AI assistant |

### Workspace Persistence

Tabs and active tab ID are auto-saved to electron-store on every tab mutation via a Zustand `subscribe` listener. On startup, `App.jsx` calls `loadWorkspace()` after `loadSessions()` to restore the previous tab state. Restored tabs reconnect automatically.

## Features

### Core Terminal
- **SSH sessions** — password or key auth, configurable keepalive, jump host / ProxyJump support
- **Local terminals** — system shell via node-pty (PowerShell, bash, etc.)
- **WSL terminals** — launch specific WSL distros
- **Split panes** — horizontal split within a single tab
- **Tab management** — drag-to-reorder, color labels, keyboard shortcuts
- **Output colorization** — auto-highlight errors/warnings/success keywords
- **Output filtering** — regex or plain-text filter with include/exclude, preset filters, copy matches
- **Search** — xterm SearchAddon with Ctrl+F
- **Broadcast mode** — type simultaneously in all open terminals

### Session Management
- **Sidebar** — grouped session list with search filter
- **Quick connect** — connect without saving a session
- **SSH config import** — parse `~/.ssh/config` (Host, HostName, User, Port, IdentityFile, ProxyJump)
- **Import/export** — JSON session backup (credentials excluded for security)

### SFTP
- **File browser** — navigate remote filesystem, breadcrumb path bar
- **Operations** — upload, download, rename, delete (recursive), mkdir
- **Favorites** — bookmark paths per session
- **Remote file editor** — double-click to edit text files, save back via SFTP (2 MB limit, binary detection)

### Port Forwarding
- **Local forwarding** (L) — `localPort` → `remoteHost:remotePort` via SSH
- **Remote forwarding** (R) — `remotePort` → `localHost:localPort` via SSH
- **Dynamic forwarding** (D) — SOCKS5 proxy on `localPort`
- **Tunnel lifecycle** — tunnels tied to SSH channel, auto-stopped on disconnect/reconnect
- **Persistent configs** — saved per session, restored on panel open

### Logging
- **Session logging** — write terminal output (ANSI-stripped) to timestamped log files
- **Auto-start** — optionally enabled via settings
- **Export** — save current terminal buffer to file via save dialog

### Connection Health
- **Latency badge** — 30-second ping polling, color-coded (green/yellow/red)
- **Auto-reconnect** — exponential backoff (5 attempts) on SSH disconnect

### AI Assistant
- **Command bar** — natural language → shell command via Claude Haiku
- **Context-aware** — sends recent terminal output for better suggestions
- **Insert or explain** — commands can be inserted directly or shown as text

### Settings
- Default font size, scrollback buffer, colorization toggle
- Keepalive interval
- Logging auto-start + log directory
- Anthropic API key (encrypted)

## Build & Development

```bash
npm run dev      # electron-vite dev server
npm run build    # electron-vite production build
npm run test     # vitest smoke tests
npm run dist     # electron-builder (NSIS installer)
npm run lint     # eslint
npm run rebuild  # electron-rebuild for node-pty
```

### Build Output
```
out/
  main/         main.js, ssh-manager.js, local-terminal.js, tunnel-manager.js, ipc/*.js
  preload/      preload.js
  renderer/     index.html, assets/
```

### Known Platform Notes
- **Windows 11 (build 26200+):** System32 may be absent from Electron's PATH. `local-terminal.js` resolves shell paths manually with PATHEXT probing as a workaround for node-pty's conpty backend.
- **node-pty:** Requires `electron-rebuild` after `npm install` if native modules were compiled against system Node instead of Electron's Node. Run rebuild from CMD/PowerShell (not git bash) due to `.bat` file dependencies.
