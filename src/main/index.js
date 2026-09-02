import { app } from 'electron'
import { startApp } from './app.js'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(startApp)
}
