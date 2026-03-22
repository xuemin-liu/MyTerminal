import React, { useState, useEffect, useRef } from 'react'
import {
  Folder, File, ChevronLeft, RefreshCw, Upload, Download,
  FolderPlus, Trash2, Edit2, Home, Star, X,
} from 'lucide-react'


function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function formatDate(mtime) {
  if (!mtime) return ''
  return new Date(mtime * 1000).toLocaleDateString()
}

export default function SftpPanel({ channelId, cwd, width, sessionKey = 'default' }) {
  const [path, setPath] = useState('/')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [favorites, setFavorites] = useState([])
  const [sftpHome, setSftpHome] = useState(null)
  const pathRef = useRef('/')
  const dropRef = useRef(null)

  const loadDir = async (dir, cdTerminal = false) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    const result = await window.electronAPI.sftp.list(channelId, dir)
    setLoading(false)
    if (result?.error) { setError(result.error); return }
    setItems(result)
    setPath(dir)
    pathRef.current = dir
    if (cdTerminal) {
      // Single-quote the path so spaces and most metacharacters are safe.
      // Escape any literal single-quotes inside the path (bash: 'it'\''s' trick).
      const safeDir = dir.replace(/'/g, "'\\''")
      window.electronAPI.ssh.write(channelId, `cd '${safeDir}'\r`)
    }
  }

  useEffect(() => {
    loadDir('/')
    // Resolve home directory via SFTP realpath('.')
    window.electronAPI.sftp.realpath(channelId, '.').then((result) => {
      if (result && !result.error) setSftpHome(result)
    })
  }, [channelId])

  // Load favorites from electron-store (persistent, survives app restarts)
  useEffect(() => {
    window.electronAPI.favorites.get(sessionKey).then(setFavorites)
  }, [sessionKey])

  // Auto-navigate when terminal cwd changes
  useEffect(() => {
    if (!cwd) return
    // Resolve ~ to home directory
    let resolved = cwd
    if (cwd === '~') {
      resolved = sftpHome || '/'
    } else if (cwd.startsWith('~/')) {
      resolved = sftpHome ? sftpHome + cwd.slice(1) : cwd.slice(1) || '/'
    }
    if (resolved && resolved !== pathRef.current) {
      loadDir(resolved)
    }
  }, [cwd, sftpHome])

  const navigate = (item) => {
    if (item.type === 'd') {
      const newPath = path === '/' ? `/${item.name}` : `${path}/${item.name}`
      loadDir(newPath)
    }
  }

  const goUp = () => {
    if (path === '/') return
    const parent = path.substring(0, path.lastIndexOf('/')) || '/'
    loadDir(parent)
  }

  const joinPath = (p, name) => (p === '/' ? `/${name}` : `${p}/${name}`)

  // ── Favorites ──────────────────────────────────────────────────────────────

  const isFavorite = favorites.includes(path)

  const toggleFavorite = () => {
    let updated
    if (isFavorite) {
      updated = favorites.filter(f => f !== path)
    } else {
      updated = [...favorites, path]
    }
    setFavorites(updated)
    window.electronAPI.favorites.set(sessionKey, updated)
  }

  const removeFavorite = (fav, e) => {
    e.stopPropagation()
    const updated = favorites.filter(f => f !== fav)
    setFavorites(updated)
    window.electronAPI.favorites.set(sessionKey, updated)
  }

  const goToFavorite = (fav) => {
    loadDir(fav, true)  // navigate SFTP + cd in terminal
  }

  // ── File operations ────────────────────────────────────────────────────────

  const handleDownload = async () => {
    if (!selected) return
    const result = await window.electronAPI.dialog.saveFile({ defaultPath: selected.name })
    if (result.canceled) return
    const res = await window.electronAPI.sftp.download(channelId, joinPath(path, selected.name), result.filePath)
    if (res?.error) setError(res.error)
  }

  const handleUpload = async () => {
    const result = await window.electronAPI.dialog.openFile({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return
    for (const localPath of result.filePaths) {
      const name = localPath.replace(/\\/g, '/').split('/').pop()
      const res = await window.electronAPI.sftp.upload(channelId, localPath, joinPath(path, name))
      if (res?.error) { setError(res.error); return }
    }
    loadDir(path)
  }

  const handleMkdir = async () => {
    const name = prompt('New folder name:')
    if (!name) return
    const res = await window.electronAPI.sftp.mkdir(channelId, joinPath(path, name))
    if (res?.error) { setError(res.error); return }
    loadDir(path)
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}"?`)) return
    const res = await window.electronAPI.sftp.delete(channelId, joinPath(path, selected.name))
    if (res?.error) { setError(res.error); return }
    setSelected(null)
    loadDir(path)
  }

  const startRename = () => {
    if (!selected) return
    setRenaming(selected)
    setRenameValue(selected.name)
  }

  const commitRename = async () => {
    if (!renaming || !renameValue || renameValue === renaming.name) { setRenaming(null); return }
    const res = await window.electronAPI.sftp.rename(channelId, joinPath(path, renaming.name), joinPath(path, renameValue))
    if (res?.error) setError(res.error)
    setRenaming(null)
    loadDir(path)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    const errors = []
    for (const file of Array.from(e.dataTransfer.files)) {
      const localPath = file.path
      if (!localPath) continue
      const name = localPath.replace(/\\/g, '/').split('/').pop()
      const res = await window.electronAPI.sftp.upload(channelId, localPath, joinPath(path, name))
      if (res?.error) errors.push(`${name}: ${res.error}`)
    }
    if (errors.length) setError(errors.join('\n'))
    loadDir(path)
  }

  return (
    <div className="sftp-panel" ref={dropRef} onDrop={handleDrop} onDragOver={e => e.preventDefault()}
      style={width ? { width } : undefined}>
      {/* Toolbar */}
      <div className="sftp-toolbar">
        <button className="icon-btn" onClick={() => loadDir(sftpHome || '/')} title="Home"><Home size={15} /></button>
        <button className="icon-btn" onClick={goUp} title="Up" disabled={path === '/'}><ChevronLeft size={15} /></button>
        <span className="sftp-path">{path}</span>
        <button
          className={`icon-btn ${isFavorite ? 'active' : ''}`}
          onClick={toggleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={15} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn" onClick={() => loadDir(path)} title="Refresh"><RefreshCw size={15} /></button>
        <button className="icon-btn" onClick={handleUpload} title="Upload"><Upload size={15} /></button>
        <button className="icon-btn" onClick={handleDownload} title="Download" disabled={!selected || selected.type === 'd'}><Download size={15} /></button>
        <button className="icon-btn" onClick={handleMkdir} title="New folder"><FolderPlus size={15} /></button>
        <button className="icon-btn" onClick={startRename} title="Rename" disabled={!selected}><Edit2 size={15} /></button>
        <button className="icon-btn danger" onClick={handleDelete} title="Delete" disabled={!selected}><Trash2 size={15} /></button>
      </div>

      {/* Favorites bar */}
      {favorites.length > 0 && (
        <div className="sftp-favorites">
          {favorites.map(fav => (
            <button
              key={fav}
              className={`fav-chip ${fav === path ? 'active' : ''}`}
              onClick={() => goToFavorite(fav)}
              title={`Go to ${fav} and cd in terminal`}
            >
              <Star size={10} fill="currentColor" />
              <span>{fav}</span>
              <span className="fav-remove" onClick={e => removeFavorite(fav, e)}><X size={9} /></span>
            </button>
          ))}
        </div>
      )}

      {error && <div className="sftp-error">{error}</div>}

      {loading ? (
        <div className="sftp-loading">Loading...</div>
      ) : (
        <div className="sftp-list">
          <table>
            <thead>
              <tr><th>Name</th><th>Size</th><th>Modified</th></tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item.name}
                  className={selected?.name === item.name ? 'selected' : ''}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => navigate(item)}
                >
                  <td>
                    <span className="sftp-file-icon">
                      {item.type === 'd' ? <Folder size={13} /> : <File size={13} />}
                    </span>
                    {renaming?.name === item.name ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : item.name}
                  </td>
                  <td>{item.type === 'd' ? '' : formatSize(item.size)}</td>
                  <td>{formatDate(item.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
