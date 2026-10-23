import { describe, expect, it } from 'vitest'
import { actionText, parseProperties, stripMnemonic } from './actionTexts'

describe('action texts', () => {
  it('parses .properties escapes and continuations', () => {
    const props = parseProperties('a=one\\\n  two\nb: x\\u2026\n# comment\nc=line\\nbreak')
    expect(props.get('a')).toBe('onetwo')
    expect(props.get('b')).toBe('x…')
    expect(props.get('c')).toBe('line\nbreak')
  })

  it('reads ActionsBundle and TerminalBundle', () => {
    expect(actionText('GotoFile')).toBe('Go to File…')
    expect(actionText('CloseContent')).toBe('Close Tab')
    expect(actionText('Terminal.NewTab')).toBe('New Tab')
    expect(stripMnemonic('_Find Action…')).toBe('Find Action…')
  })
})
