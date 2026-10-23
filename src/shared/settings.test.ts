import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'

describe('settings', () => {
  it('fills missing values with the defaults and drops unknown ones', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ editor: { fontSize: 15 }, other: 1 })).toEqual({ ...DEFAULT_SETTINGS, editor: { fontSize: 15, lineHeight: 20 } })
  })

  it('clamps numbers and rejects wrong types', () => {
    const settings = normalizeSettings({
      editor: { fontSize: 200, lineHeight: '30' },
      terminal: { fontSize: 2.6, shell: ' /bin/bash ', agentCommand: 42 },
      eslint: { enabled: 'no' },
      markdown: { defaultLayout: 'sideways' },
    })
    expect(settings).toEqual({
      editor: { fontSize: 32, lineHeight: 20 },
      terminal: { fontSize: 8, shell: '/bin/bash', agentCommand: 'claude' },
      eslint: { enabled: true },
      markdown: { defaultLayout: 'auto' },
    })
  })
})
