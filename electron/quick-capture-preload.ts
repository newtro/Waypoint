import { contextBridge, ipcRenderer } from 'electron'

const token = process.argv.find((item) => item.startsWith('--quick-capture-token='))?.slice('--quick-capture-token='.length)
if (!token) throw new Error('Quick capture token is missing')

contextBridge.exposeInMainWorld('quickCapture', {
  select: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('waypoint:quick-capture-select', { token, bounds }),
  cancel: () => ipcRenderer.send('waypoint:quick-capture-cancel', { token }),
})
