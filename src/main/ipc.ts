import { ipcMain, type WebContents } from 'electron'
import type { EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannels } from '@shared/ipc'

export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as InvokeArgs<C>)))
}

export function onSend<C extends keyof SendChannels>(channel: C, listener: (...args: SendChannels[C]) => void): void {
  ipcMain.on(channel, (_event, ...args) => listener(...(args as SendChannels[C])))
}

export function emit<C extends keyof EventChannels>(target: WebContents, channel: C, ...args: EventChannels[C]): void {
  if (!target.isDestroyed()) target.send(channel, ...args)
}
