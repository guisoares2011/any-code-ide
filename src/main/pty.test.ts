import { describe, expect, it } from 'vitest'
import { shellInvocation, shellQuote, terminalEnv } from './pty'

describe('pty helpers', () => {
  it('quotes shell words only when needed', () => {
    expect(shellQuote('claude')).toBe('claude')
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellInvocation('/bin/zsh', ['npm', 'run', 'dev'])).toEqual({ file: '/bin/zsh', args: ['-l', '-c', 'exec npm run dev'] })
    expect(shellInvocation('/bin/zsh', undefined)).toEqual({ file: '/bin/zsh', args: ['-l'] })
  })

  it('drops Claude Code session markers and adds the bridge variables', () => {
    const env = terminalEnv(
      { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: 'x', CLAUDE_CONFIG_DIR: '/c' },
      { CLAUDE_CODE_SSE_PORT: '1234', ENABLE_IDE_INTEGRATION: 'true' },
    )
    expect(env).toMatchObject({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_SSE_PORT: '1234', TERM: 'xterm-256color' })
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
  })
})
