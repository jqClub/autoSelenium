const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    startAutomation: (data) => ipcRenderer.invoke('start-automation', data),
    loadUrls: () => ipcRenderer.invoke('load-urls'),
    stopAutomation: () => ipcRenderer.invoke('stop-automation'),
    onAutomationCompleted: (callback) => ipcRenderer.on('automation-completed', callback)
}) 