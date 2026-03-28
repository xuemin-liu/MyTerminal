import React, { useState } from 'react'
import { X } from 'lucide-react'
import useSessionStore from '../store/useSessionStore'

export default function SettingsDialog({ onClose }) {
  const { settings, updateSettings } = useSessionStore()
  const [local, setLocal] = useState({ ...settings })

  const handleChange = (key, value) => {
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    await updateSettings(local)
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div className="dialog-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dialog-body">
          <div className="form-group">
            <label>Default Font Size</label>
            <input
              type="number"
              min={8}
              max={32}
              value={local.defaultFontSize}
              onChange={(e) => handleChange('defaultFontSize', parseInt(e.target.value) || 14)}
            />
          </div>
          <div className="form-group">
            <label>Default Scrollback Lines</label>
            <input
              type="number"
              min={1000}
              max={100000}
              step={1000}
              value={local.defaultScrollback}
              onChange={(e) => handleChange('defaultScrollback', parseInt(e.target.value) || 10000)}
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={local.colorizeByDefault}
                onChange={(e) => handleChange('colorizeByDefault', e.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Colorize output by default
            </label>
          </div>
          <div className="form-group">
            <label>SSH Keepalive Interval (ms)</label>
            <input
              type="number"
              min={0}
              max={300000}
              step={1000}
              value={local.keepaliveInterval}
              onChange={(e) => handleChange('keepaliveInterval', parseInt(e.target.value) || 10000)}
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={local.loggingEnabled}
                onChange={(e) => handleChange('loggingEnabled', e.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Enable session logging
            </label>
          </div>
          <div className="form-group">
            <label>Log Directory</label>
            <div className="input-row">
              <input
                type="text"
                placeholder="Leave empty for default"
                value={local.logDirectory}
                onChange={(e) => handleChange('logDirectory', e.target.value)}
              />
              <button
                className="browse-btn"
                onClick={async () => {
                  const result = await window.electronAPI.dialog.openFile({ properties: ['openDirectory'] })
                  if (!result.canceled && result.filePaths[0]) handleChange('logDirectory', result.filePaths[0])
                }}
              >
                Browse
              </button>
            </div>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
