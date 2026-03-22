import React, { useState } from 'react'
import { X, Terminal, Plus } from 'lucide-react'
import useSessionStore from '../store/useSessionStore'
import SessionDialog from './SessionDialog'

export default function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useSessionStore()
  const [quickConnect, setQuickConnect] = useState(false)

  const handleClose = (e, tabId) => {
    e.stopPropagation()
    closeTab(tabId)
  }

  return (
    <div className="tabbar">
      <div className="tabbar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Terminal size={13} className="tab-icon" />
            <span className="tab-label">{tab.label}</span>
            <button
              className="tab-close"
              onClick={(e) => handleClose(e, tab.id)}
              title="Close tab"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="tab-new" onClick={() => setQuickConnect(true)} title="Quick connect">
        <Plus size={16} />
      </button>
      {quickConnect && (
        <SessionDialog
          session={null}
          onClose={() => setQuickConnect(false)}
        />
      )}
    </div>
  )
}
