import React, { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import TerminalTab from './components/TerminalTab'
import useSessionStore from './store/useSessionStore'
import TitleBar from './components/TitleBar'

export default function App() {
  const { tabs, activeTabId, loadSessions, loadWorkspace } = useSessionStore()

  useEffect(() => {
    loadSessions().then(() => loadWorkspace())
  }, [])

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <div className="main-area">
          <TabBar />
          <div className="tab-content">
            {tabs.length === 0 ? (
              <div className="welcome-screen">
                <div className="welcome-inner">
                  <h1>MyTerminal</h1>
                  <p>Connect to a remote server to get started.</p>
                  <p className="hint">Double-click a session in the sidebar, or use the quick-connect button.</p>
                </div>
              </div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="tab-pane"
                  style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
                >
                  <TerminalTab tab={tab} isActive={tab.id === activeTabId} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
