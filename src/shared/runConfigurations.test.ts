import { describe, expect, it } from 'vitest'
import { formatEnv, junitName, parseEnv } from './runConfigurations'

describe('environment variables field', () => {
  it('round-trips the IntelliJ format', () => {
    const env = { SPRING_PROFILES_ACTIVE: 'local', JDBC_URL: 'jdbc:postgresql://h/db?a=b' }
    expect(parseEnv(formatEnv(env))).toEqual(env)
    expect(parseEnv(' A=1 ;; B= ;C')).toEqual({ A: '1', B: '', C: '' })
  })
})

describe('test configuration names', () => {
  it('follows IntelliJ', () => {
    const spec = { module: 'api', packageName: 'com.acme', className: 'com.acme.ApiTest', methodName: 'greets' }
    expect(junitName({ ...spec, scope: 'method' })).toBe('ApiTest.greets')
    expect(junitName({ ...spec, scope: 'class' })).toBe('ApiTest')
    expect(junitName({ ...spec, scope: 'package' })).toBe("Tests in 'com.acme'")
    expect(junitName({ ...spec, scope: 'module' })).toBe('All in api')
  })
})
