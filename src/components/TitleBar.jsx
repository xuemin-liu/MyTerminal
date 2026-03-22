import React from 'react'
import { Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">MyTerminal</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn minimize"
          onClick={() => window.electronAPI.window.minimize()}
          title="Minimize"
        >
          <Minus size={12} />
        </button>
        <button
          className="titlebar-btn maximize"
          onClick={() => window.electronAPI.window.maximize()}
          title="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="titlebar-btn close"
          onClick={() => window.electronAPI.window.close()}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
