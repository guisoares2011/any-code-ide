import { describe, expect, it } from 'vitest'
import { launchedOutsideTerminal, parseShellEnv, resolveShellEnv } from './shellEnv'

const MARK = '__ANYCODE_SHELL_ENV__'

describe('shell environment', () => {
  it('reads the env -0 dump between the markers and ignores rc-file noise', () => {
    const output = `Welcome!\n${MARK}PATH=/a:/b\0MULTI=one\ntwo\0SHLVL=2\0_=/usr/bin/env\0${MARK}bye`
    expect(parseShellEnv(output)).toEqual({ PATH: '/a:/b', MULTI: 'one\ntwo' })
    expect(parseShellEnv('no markers')).toEqual({})
  })

  it('only resolves when the app was not started from a terminal', () => {
    expect(launchedOutsideTerminal({ PATH: '/usr/bin:/bin' })).toBe(true)
    expect(launchedOutsideTerminal({ TERM: 'xterm-256color' })).toBe(false)
  })

  it('gets the environment of a real login shell', async () => {
    const env = await resolveShellEnv('/bin/sh')
    expect(env.PATH).toBeTruthy()
  })
})
