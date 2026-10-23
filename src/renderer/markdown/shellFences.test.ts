import { describe, expect, it } from 'vitest'
import { findShellFences, isShellLanguage, shellCommand, stripTrailingComment } from './shellFences'

describe('runnable shell blocks', () => {
  it('recognizes shell fence languages', () => {
    expect(isShellLanguage('bash')).toBe(true)
    expect(isShellLanguage('sh title="x"')).toBe(true)
    expect(isShellLanguage('Console')).toBe(true)
    expect(isShellLanguage('ts')).toBe(false)
  })

  it('drops prompts, comments and output lines of console transcripts', () => {
    expect(shellCommand('$ npm install # deps\n$ npm test\nadded 3 packages\n')).toBe('npm install\nnpm test')
    expect(shellCommand('# setup\ncd app\n\necho "a # b" # note\n')).toBe('cd app\necho "a # b"')
    expect(stripTrailingComment("echo '#not' x#y # real")).toBe("echo '#not' x#y")
  })

  it('finds fences with their lines', () => {
    const markdown = ['# Title', '', '```bash', '$ npm install', '```', '', '```ts', 'const x = 1', '```', '', '~~~sh', 'echo hi', '~~~'].join('\n')
    expect(findShellFences(markdown)).toEqual([
      { startLine: 2, endLine: 5, language: 'bash', command: 'npm install' },
      { startLine: 10, endLine: 13, language: 'sh', command: 'echo hi' },
    ])
  })
})
