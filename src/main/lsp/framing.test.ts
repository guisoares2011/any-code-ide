import { describe, expect, it } from 'vitest'
import { encodeMessage, MessageReader } from './framing'

describe('LSP framing', () => {
  it('round-trips messages split across chunks, with multi-byte characters', () => {
    const messages: unknown[] = []
    const reader = new MessageReader((m) => messages.push(m))
    const first = encodeMessage({ jsonrpc: '2.0', id: 1, result: 'olá — ✓' })
    const second = encodeMessage({ jsonrpc: '2.0', method: 'x' })
    const stream = Buffer.concat([first, second])
    for (let i = 0; i < stream.length; i += 7) reader.push(stream.subarray(i, i + 7))
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'olá — ✓' },
      { jsonrpc: '2.0', method: 'x' },
    ])
  })

  it('counts Content-Length in bytes, not characters', () => {
    expect(encodeMessage({ a: 'é' }).toString('utf8')).toBe('Content-Length: 10\r\n\r\n{"a":"é"}')
  })
})
