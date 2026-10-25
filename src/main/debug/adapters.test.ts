import { describe, expect, it } from 'vitest'
import { withJavaDebugBundle } from './adapters'

describe('java-debug in jdtls', () => {
  it('adds the plugin jar to the bundles of initialize only', () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { initializationOptions: { settings: { a: 1 } } } }
    expect(withJavaDebugBundle(initialize, '/x/java-debug.jar')).toEqual({
      ...initialize,
      params: { initializationOptions: { settings: { a: 1 }, bundles: ['/x/java-debug.jar'] } },
    })
    const other = { jsonrpc: '2.0', method: 'initialized', params: {} }
    expect(withJavaDebugBundle(other, '/x/java-debug.jar')).toBe(other)
    expect(withJavaDebugBundle(initialize, null)).toBe(initialize)
  })
})
