import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, type AnyCodeBridge } from '@shared/ipc'

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const sendAllowed = new Set<string>(SEND_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

const bridge: AnyCodeBridge = {
  invoke(channel, ...args) {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel, ...args) {
    if (sendAllowed.has(channel)) ipcRenderer.send(channel, ...args)
  },
  on(channel, listener) {
    if (!eventAllowed.has(channel)) throw new Error(`Blocked IPC event: ${channel}`)
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      ;(listener as (...values: unknown[]) => void)(...args)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('anycode', bridge)
