import { create } from 'zustand'

let tabIdCounter = 0

const useSessionStore = create((set, get) => ({
  sessions: [],
  tabs: [],
  activeTabId: null,

  // ── Session actions ──────────────────────────────────────────────────────────

  loadSessions: async () => {
    const sessions = await window.electronAPI.sessions.getAll()
    set({ sessions })
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

  // ── Tab actions ──────────────────────────────────────────────────────────────

  openTab: (session) => {
    const id = `tab-${++tabIdCounter}`
    const tab = {
      id,
      sessionId: session.id,
      label: session.name || `${session.username}@${session.host}`,
      config: { ...session },
      channelId: id, // reuse tab id as channel id
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }))
    return tab
  },

  openQuickConnectTab: (config) => {
    const id = `tab-${++tabIdCounter}`
    const tab = {
      id,
      sessionId: null,
      label: `${config.username}@${config.host}`,
      config,
      channelId: id,
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }))
    return tab
  },

  closeTab: (tabId) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId)
      let activeTabId = state.activeTabId
      if (activeTabId === tabId) {
        const idx = state.tabs.findIndex((t) => t.id === tabId)
        if (tabs.length === 0) {
          activeTabId = null
        } else {
          activeTabId = tabs[Math.min(idx, tabs.length - 1)].id
        }
      }
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),
}))

export default useSessionStore
