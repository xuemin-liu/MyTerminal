import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// StrictMode is intentionally omitted: it double-invokes effects in dev,
// which causes duplicate SSH/PTY connection attempts and spurious terminal noise.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
