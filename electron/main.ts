import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 620,
    backgroundColor: '#111b19',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const developmentUrl = process.env.VITE_DEV_SERVER_URL
  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(path.join(currentDirectory, '../../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
