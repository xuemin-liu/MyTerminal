import React, { useState, useEffect } from 'react'
import { X, Key, Lock } from 'lucide-react'
import useSessionStore from '../store/useSessionStore'

const DEFAULT_FORM = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authType: 'password',
  password: '',
  keyPath: '',
  passphrase: '',
}

export default function SessionDialog({ session, onClose }) {
  const { addSession, updateSession, openTab } = useSessionStore()
  const [form, setForm] = useState(DEFAULT_FORM)

  useEffect(() => {
    if (session) {
      setForm({
        name: session.name || '',
        host: session.host || '',
        port: String(session.port || 22),
        username: session.username || '',
        authType: session.authType || 'password',
        password: session.password || '',
        keyPath: session.keyPath || '',
        passphrase: session.passphrase || '',
      })
    }
  }, [session])

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (!form.host || !form.username) return
    const data = {
      id: session?.id || crypto.randomUUID(),
      name: form.name || `${form.username}@${form.host}`,
      host: form.host,
      port: parseInt(form.port, 10) || 22,
      username: form.username,
      authType: form.authType,
      password: form.authType === 'password' ? form.password : '',
      keyPath: form.authType === 'key' ? form.keyPath : '',
      passphrase: form.authType === 'key' ? form.passphrase : '',
    }
    if (session) {
      await updateSession(data)
    } else {
      await addSession(data)
    }
    onClose()
  }

  const handleConnect = async () => {
    if (!form.host || !form.username) return
    const config = {
      id: session?.id || crypto.randomUUID(),
      name: form.name || `${form.username}@${form.host}`,
      host: form.host,
      port: parseInt(form.port, 10) || 22,
      username: form.username,
      authType: form.authType,
      password: form.authType === 'password' ? form.password : '',
      keyPath: form.authType === 'key' ? form.keyPath : '',
      passphrase: form.authType === 'key' ? form.passphrase : '',
    }
    openTab(config)
    onClose()
  }

  const browseKeyFile = async () => {
    const result = await window.electronAPI.dialog.openFile({
      title: 'Select Private Key File',
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      set('keyPath', result.filePaths[0])
    }
  }

  return (
    <div className="dialog-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-header">
          <h2>{session ? 'Edit Session' : 'New Session'}</h2>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Name (optional)</label>
            <input
              type="text"
              placeholder="My Server"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="form-group flex-1">
              <label>Host *</label>
              <input
                type="text"
                placeholder="192.168.1.1"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ width: 80 }}>
              <label>Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Username *</label>
            <input
              type="text"
              placeholder="root"
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Authentication</label>
            <div className="auth-toggle">
              <button
                className={form.authType === 'password' ? 'active' : ''}
                onClick={() => set('authType', 'password')}
              >
                <Lock size={13} /> Password
              </button>
              <button
                className={form.authType === 'key' ? 'active' : ''}
                onClick={() => set('authType', 'key')}
              >
                <Key size={13} /> Private Key
              </button>
            </div>
          </div>

          {form.authType === 'password' ? (
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>Key File</label>
                <div className="input-row">
                  <input
                    type="text"
                    placeholder="/home/user/.ssh/id_rsa"
                    value={form.keyPath}
                    onChange={(e) => set('keyPath', e.target.value)}
                    readOnly
                  />
                  <button className="browse-btn" onClick={browseKeyFile}>Browse</button>
                </div>
              </div>
              <div className="form-group">
                <label>Passphrase (optional)</label>
                <input
                  type="password"
                  placeholder="Key passphrase"
                  value={form.passphrase}
                  onChange={(e) => set('passphrase', e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-secondary" onClick={handleSave}>Save</button>
          <button className="btn-primary" onClick={handleConnect}>Connect</button>
        </div>
      </div>
    </div>
  )
}
