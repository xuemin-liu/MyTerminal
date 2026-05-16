#!/usr/bin/env node
// CLI: dump a credentials-stripped backup. For full migration (including
// passwords and the AI key) use Settings → Backup & Restore → Export backup
// inside the running app — only Electron's safeStorage can decrypt those blobs.
//
// Usage:
//   node scripts/export-backup.js <output.json>
//   node scripts/export-backup.js <output.json> --data-dir <path>
//   npm run export-backup -- <output.json>
//
// Reads electron-store's JSON file directly. Sensitive fields are encrypted on
// disk via safeStorage and can't be decrypted outside the Electron runtime, so
// this CLI strips them — the GUI export includes them in plaintext.

const fs = require('fs')
const path = require('path')
const os = require('os')

const APP_NAME = 'my-terminal'  // matches package.json "name"
const STORE_NAME = 'sessions'   // matches new Store({ name: 'sessions' }) in main.js
const BACKUP_VERSION = 1
const SENSITIVE_FIELDS = ['password', 'passphrase', 'jumpPassword', 'jumpPassphrase']

function defaultUserDataDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, APP_NAME)
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(xdg, APP_NAME)
}

function parseArgs(argv) {
  const args = { output: null, dataDir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--data-dir') args.dataDir = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else if (!args.output) args.output = a
  }
  return args
}

function usage() {
  console.log(`Usage: node scripts/export-backup.js <output.json> [--data-dir <path>]

Default data dir: ${defaultUserDataDir()}

Close the MyTerminal app before running so writes don't race the export.`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.output) { usage(); process.exit(args.help ? 0 : 1) }

  const dataDir = args.dataDir || defaultUserDataDir()
  const storePath = path.join(dataDir, `${STORE_NAME}.json`)

  if (!fs.existsSync(storePath)) {
    console.error(`Store file not found: ${storePath}`)
    console.error(`Pass --data-dir if your install lives elsewhere.`)
    process.exit(2)
  }

  let store
  try {
    store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  } catch (e) {
    console.error(`Failed to read ${storePath}: ${e.message}`)
    process.exit(3)
  }

  const sessions = Array.isArray(store.sessions) ? store.sessions.map((s) => {
    const clean = { ...s }
    for (const f of SENSITIVE_FIELDS) delete clean[f]
    return clean
  }) : []

  const payload = {
    app: 'MyTerminal',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    snippets: Array.isArray(store.snippets) ? store.snippets : [],
    sftpFavorites: store['sftp-favorites'] && typeof store['sftp-favorites'] === 'object' ? store['sftp-favorites'] : {},
    filterPresets: Array.isArray(store['filter-presets']) ? store['filter-presets'] : [],
    tunnelConfigs: store['tunnel-configs'] && typeof store['tunnel-configs'] === 'object' ? store['tunnel-configs'] : {},
    settingsPrefs: store['settings-prefs'] && typeof store['settings-prefs'] === 'object' ? store['settings-prefs'] : {},
  }

  const outPath = path.resolve(args.output)
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')

  const counts = [
    `${payload.sessions.length} sessions`,
    `${payload.snippets.length} snippets`,
    `${Object.keys(payload.sftpFavorites).length} SFTP favorite sets`,
    `${payload.filterPresets.length} filter presets`,
    `${Object.keys(payload.tunnelConfigs).length} tunnel config sets`,
    `${Object.keys(payload.settingsPrefs).length} preferences`,
  ]
  console.log(`Wrote ${outPath}`)
  console.log(`  ${counts.join(', ')}`)
}

main()
