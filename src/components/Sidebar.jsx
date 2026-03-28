import React, { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, Edit2, Terminal, Download, Upload, ChevronDown, ChevronRight, Search, Settings, FileUp } from 'lucide-react'
import useSessionStore from '../store/useSessionStore'
import SessionDialog from './SessionDialog'
import SettingsDialog from './SettingsDialog'

export default function Sidebar() {
  const { sessions, openTab, deleteSession, exportSessions, importSessions } = useSessionStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editSession, setEditSession] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [collapsed, setCollapsed] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleEdit = () => {
    setEditSession(contextMenu.session)
    setDialogOpen(true)
    setContextMenu(null)
  }

  const handleDelete = async () => {
    await deleteSession(contextMenu.session.id)
    setContextMenu(null)
  }

  const toggleGroup = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleImport = async () => {
    const result = await importSessions()
    if (result?.error) alert('Import failed: ' + result.error)
  }

  const handleImportSshConfig = async () => {
    const result = await window.electronAPI.sshconfig.import()
    if (result?.error) { alert('SSH config import failed: ' + result.error); return }
    if (result?.imported > 0) {
      const store = useSessionStore.getState()
      await store.loadSessions()
    }
  }

  // Filter sessions by search query
  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) => {
        const q = searchQuery.toLowerCase()
        return (s.name || '').toLowerCase().includes(q) ||
               (s.host || '').toLowerCase().includes(q) ||
               (s.username || '').toLowerCase().includes(q) ||
               (s.group || '').toLowerCase().includes(q)
      })
    : sessions

  // Group sessions
  const grouped = filteredSessions.reduce((acc, s) => {
    const key = s.group || ''
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (!a) return 1
    if (!b) return -1
    return a.localeCompare(b)
  })

  const SessionItem = ({ s }) => (
    <div
      className="session-item"
      onDoubleClick={() => openTab(s)}
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, session: s }) }}
      title={`${s.username}@${s.host}:${s.port || 22}`}
    >
      <Terminal size={14} className="session-icon" />
      <div className="session-info">
        <span className="session-name">{s.name || s.host}</span>
        <span className="session-host">{s.username}@{s.host}</span>
      </div>
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings"><Settings size={15} /></button>
        <button className="icon-btn" onClick={exportSessions} title="Export sessions"><Download size={15} /></button>
        <button className="icon-btn" onClick={handleImport} title="Import sessions"><Upload size={15} /></button>
        <button className="icon-btn" onClick={handleImportSshConfig} title="Import SSH Config"><FileUp size={15} /></button>
        <button className="icon-btn" onClick={() => { setEditSession(null); setDialogOpen(true) }} title="New Session">
          <Plus size={16} />
        </button>
      </div>

      <div className="sidebar-search">
        <Search size={13} />
        <input
          placeholder="Search sessions…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="session-list">
        {filteredSessions.length === 0 && <div className="session-empty">{searchQuery ? 'No matches' : 'No saved sessions'}</div>}

        {groupKeys.map((key) => (
          <div key={key} className="session-group">
            {key && (
              <div className="session-group-header" onClick={() => toggleGroup(key)}>
                {collapsed.has(key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span>{key}</span>
                <span className="group-count">{grouped[key].length}</span>
              </div>
            )}
            {!collapsed.has(key) && grouped[key].map((s) => <SessionItem key={s.id} s={s} />)}
          </div>
        ))}
      </div>

      {contextMenu && (
        <div ref={menuRef} className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button onClick={handleEdit}><Edit2 size={13} /> Edit</button>
          <button onClick={handleDelete} className="danger"><Trash2 size={13} /> Delete</button>
        </div>
      )}

      {dialogOpen && (
        <SessionDialog
          session={editSession}
          onClose={() => { setDialogOpen(false); setEditSession(null) }}
        />
      )}

      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </aside>
  )
}
