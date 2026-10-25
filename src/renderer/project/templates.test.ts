import { describe, expect, it } from 'vitest'
import { packageOf, typeTemplate } from './templates'

describe('New Java/Kotlin class', () => {
  it('finds the source root and package of a directory', () => {
    expect(packageOf('/p/app/src/main/java/com/acme')).toEqual({ sourceRoot: '/p/app/src/main/java', packageName: 'com.acme' })
    expect(packageOf('/p/src/test/kotlin')).toEqual({ sourceRoot: '/p/src/test/kotlin', packageName: '' })
    expect(packageOf('/p/src/components')).toBeNull()
  })

  it("writes IntelliJ's default templates", () => {
    expect(typeTemplate('java', 'class', 'com.acme', 'Greeter')).toBe('package com.acme;\n\npublic class Greeter {\n}\n')
    expect(typeTemplate('java', 'record', '', 'Point')).toBe('public record Point() {\n}\n')
    expect(typeTemplate('kotlin', 'data class', 'com.acme', 'User')).toBe('package com.acme\n\ndata class User()\n')
    expect(typeTemplate('kotlin', 'file', 'com.acme', 'Utils')).toBe('package com.acme\n\n')
  })
})
