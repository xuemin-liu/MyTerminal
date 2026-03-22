import { create } from 'zustand'


const useSessionStore = create((set, get) => ({
  sessions: [],
  tabs: [],
  activeTabId: null,
  snippets: [],
  broadcastMode: false,

  // ── Session actions ──────────────────────────────────────────────────────────

  loadSessions: async () => {
    const sessions = await window.electronAPI.sessions.getAll()
    const snippets = await window.electronAPI.snippets.getAll()
    set({ sessions, snippets })
  },

  addSession: async (session) => {
    const saved = await window.electronAPI.sessions.save(session)
    set({ sessions: saved })
  },

  updateSession: async (session) => {
    const saved = await window.electronAPI.sessions.save(session)
    set({ sessions: saved })
  },

  deleteSession: async (id) => {
    const saved = await window.electronAPI.sessions.delete(id)
    set({ sessions: saved })
  },

  exportSessions: async () => {
    const { sessions } = get()
    return await window.electronAPI.sessions.export(sessions)
  },

  importSessions: async () => {
    const result = await window.electronAPI.sessions.import()
    if (Array.isArray(result)) set({ sessions: result })
    return result
  },

  // ── Snippet actions ──────────────────────────────────────────────────────────

  addSnippet: async (snippet) => {
    const saved = await window.electronAPI.snippets.save({
      ...snippet,
      id: snippet.id || crypto.randomUUID(),
    })
    set({ snippets: saved })
  },

  deleteSnippet: async (id) => {
    const saved = await window.electronAPI.snippets.delete(id)
    set({ snippets: saved })
  },

  // ── Broadcast ────────────────────────────────────────────────────────────────

  toggleBroadcast: () => set((state) => ({ broadcastMode: !state.broadcastMode })),

  // ── Tab actions ──────────────────────────────────────────────────────────────

  openTab: (session) => {
    const id = crypto.randomUUID()
    const tab = {
      id,
      sessionId: session.id,
      label: session.name || `${session.username}@${session.host}${session.port && session.port !== 22 ? ':' + session.port : ''}`,
      config: { ...session },
      channelId: id,
      color: null,
      splitChannelId: null,
      splitConfig: null,
      isLocal: false,
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return tab
  },

  openQuickConnectTab: (config) => {
    const id = crypto.randomUUID()
    const tab = {
      id,
      sessionId: null,
      label: `${config.username}@${config.host}${config.port && config.port !== 22 ? ':' + config.port : ''}`,
      config,
      channelId: id,
      color: null,
      splitChannelId: null,
      splitConfig: null,
      isLocal: false,
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return tab
  },

  openLocalTab: () => {
    const id = crypto.randomUUID()
    const tab = {
      id,
      sessionId: null,
      label: 'Local Terminal',
      config: null,
      channelId: id,
      color: null,
      splitChannelId: null,
      splitConfig: null,
      isLocal: true,
      wslDistro: null,
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return tab
  },

  openWslTab: (distro) => {
    const id = crypto.randomUUID()
    const tab = {
      id,
      sessionId: null,
      label: distro ? `WSL: ${distro}` : 'WSL',
      config: null,
      channelId: id,
      color: null,
      splitChannelId: null,
      splitConfig: null,
      isLocal: true,
      wslDistro: distro || null,
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return tab
  },

  closeTab: (tabId) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      let activeTabId = state.activeTabId
      if (activeTabId === tabId) {
        const idx = state.tabs.findIndex((t) => t.id === tabId)
        activeTabId = tabs.length === 0 ? null : tabs[Math.min(idx, tabs.length - 1)].id
      }
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTab: (tabId, patch) => set((state) => ({
    tabs: state.tabs.map((t) => t.id === tabId ? { ...t, ...patch } : t),
  })),

  addSplitPane: (tabId) => {
    const id = crypto.randomUUID()
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, splitChannelId: id, splitConfig: { ...t.config } } : t
      ),
    }))
    return id
  },

  removeSplitPane: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, splitChannelId: null, splitConfig: null } : t
      ),
    }))
  },
}))

export default useSessionStore
