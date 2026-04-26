export function writeToTerminalChannel(tab, data, channelId = tab.channelId) {
  if (tab.isLocal) window.electronAPI.local.write(channelId, data)
  else window.electronAPI.ssh.write(channelId, data)
}

export function resizeTerminalChannel(tab, cols, rows, channelId = tab.channelId) {
  if (tab.isLocal) window.electronAPI.local.resize(channelId, cols, rows)
  else window.electronAPI.ssh.resize(channelId, cols, rows)
}

export function writeToBroadcastTargets(tabs, data) {
  tabs.forEach((tab) => writeToTerminalChannel(tab, data))
}
