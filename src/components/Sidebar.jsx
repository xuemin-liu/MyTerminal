import React, { useState, useRef, useEffect } from 'react'
import { Monitor, Plus, Trash2, Edit2, Terminal } from 'lucide-react'
import useSessionStore from '../store/useSessionStore'
import SessionDialog from './SessionDialog'

export default function Sidebar() {
  const { sessions, openTab, deleteSession } = useSessionStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editSession, setEditSession] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const menuRef = useRef(null)

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDoubleClick = (session) => {
    openTab(session)
  }

  const handleContextMenu = (e, session) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, session })
  }

  const handleEdit = () => {
    setEditSession(contextMenu.session)
    setDialogOpen(true)
    setContextMenu(null)
  }

  const handleDelete = async () => {
    await deleteSession(contextMenu.session.id)
    setContextMenu(null)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <button
          className="icon-btn"
          onClick={() => { setEditSession(null); setDialogOpen(true) }}
          title="New Session"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <div className="session-empty">No saved sessions</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className="session-item"
            onDoubleClick={() => handleDoubleClick(s)}
            onContextMenu={(e) => handleContextMenu(e, s)}
            title={`${s.username}@${s.host}:${s.port || 22}`}
          >
            <Terminal size={14} className="session-icon" />
            <div className="session-info">
              <span className="session-name">{s.name || s.host}</span>
              <span className="session-host">{s.username}@{s.host}</span>
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={handleEdit}>
            <Edit2 size={13} /> Edit
          </button>
          <button onClick={handleDelete} className="danger">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}

      {dialogOpen && (
        <SessionDialog
          session={editSession}
          onClose={() => { setDialogOpen(false); setEditSession(null) }}
        />
      )}
    </aside>
  )
}
