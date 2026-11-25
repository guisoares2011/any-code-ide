import { describe, expect, it } from 'vitest'
import { projectColorIndex, projectInitials } from './projectAvatar'

describe('project avatar', () => {
  it('takes the initials of the first two words', () => {
    expect(projectInitials('admin-bff')).toBe('AB')
    expect(projectInitials('CodingPlataform')).toBe('CP')
    expect(projectInitials('iac')).toBe('I')
    expect(projectInitials('core-87-poc')).toBe('CP')
    expect(projectInitials('my_app.web')).toBe('MA')
    expect(projectInitials('123')).toBe('?')
  })

  it('keeps one of the nine theme gradients per path', () => {
    const index = projectColorIndex('/Users/me/Documents/admin-bff')
    expect(index).toBe(projectColorIndex('/Users/me/Documents/admin-bff'))
    expect(index).toBeGreaterThanOrEqual(1)
    expect(index).toBeLessThanOrEqual(9)
  })
})
