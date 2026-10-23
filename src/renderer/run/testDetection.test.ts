import { describe, expect, it } from 'vitest'
import { findTests, moduleOfTestFile } from './testDetection'

describe('JUnit test detection', () => {
  it('finds Java test classes and methods', () => {
    const source = [
      'package com.acme;',
      '',
      'import org.junit.jupiter.api.Test;',
      '',
      '/* class Fake { @Test void no() {} } */',
      'class GreetingTest {',
      '  @Test',
      '  void greets() {',
      '    String s = "class X { @Test void y() }";',
      '  }',
      '',
      '  @ParameterizedTest @ValueSource(strings = {"a"})',
      '  public void repeats(String value) {}',
      '',
      '  void helper() {}',
      '',
      '  @org.junit.jupiter.api.Test void inline() {}',
      '}',
    ].join('\n')
    expect(findTests(source)).toEqual({
      packageName: 'com.acme',
      classes: [
        {
          className: 'com.acme.GreetingTest',
          line: 6,
          methods: [
            { name: 'greets', line: 8 },
            { name: 'repeats', line: 13 },
            { name: 'inline', line: 17 },
          ],
        },
      ],
    })
  })

  it('finds Kotlin tests, including backtick names, and skips classes without tests', () => {
    const source = [
      'package com.acme',
      'class Helper { fun x() = 1 }',
      'class GreetingTest {',
      '    @Test',
      '    fun `greets by name`() {}',
      '    @Test fun plain() {',
      '        val c = object : Runnable { override fun run() {} }',
      '    }',
      '}',
    ].join('\n')
    expect(findTests(source).classes).toEqual([
      {
        className: 'com.acme.GreetingTest',
        line: 3,
        methods: [
          { name: 'greets by name', line: 5 },
          { name: 'plain', line: 6 },
        ],
      },
    ])
  })

  it('derives the module from the test source path', () => {
    expect(moduleOfTestFile('/p', '/p/api/src/test/java/com/acme/ApiTest.java')).toBe('api')
    expect(moduleOfTestFile('/p', '/p/libs/core/src/test/kotlin/A.kt')).toBe('libs/core')
    expect(moduleOfTestFile('/p', '/p/src/test/java/A.java')).toBe('')
  })
})
