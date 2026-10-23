import { describe, expect, it } from 'vitest'
import { formatEnv, parseEnv } from './runConfigurations'

describe('environment variables field', () => {
  it('round-trips the IntelliJ format', () => {
    const env = { SPRING_PROFILES_ACTIVE: 'local', JDBC_URL: 'jdbc:postgresql://h/db?a=b' }
    expect(parseEnv(formatEnv(env))).toEqual(env)
    expect(parseEnv(' A=1 ;; B= ;C')).toEqual({ A: '1', B: '', C: '' })
  })
})
