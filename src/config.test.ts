import { describe, expect, it } from 'vitest'

import { agentContract } from './agent/agentContract'
import { getAppConfig } from './config'

const validEnv = {
  VITE_API_URL: 'http://localhost:7000/v1/chat/completions',
  VITE_AGENT_MODEL: 'presentation-safe-model',
}

describe('getAppConfig', () => {
  it('accepts a valid frontend agent configuration', () => {
    expect(getAppConfig(validEnv as ImportMetaEnv)).toMatchObject({
      apiUrl: validEnv.VITE_API_URL,
      agentModel: validEnv.VITE_AGENT_MODEL,
    })
  })

  it('rejects a missing VITE_API_URL as a configuration error', () => {
    expect(() =>
      getAppConfig({ VITE_AGENT_MODEL: validEnv.VITE_AGENT_MODEL } as ImportMetaEnv),
    ).toThrow(/configuration|VITE_API_URL/i)
  })

  it('rejects a missing VITE_AGENT_MODEL as a configuration error', () => {
    expect(() => getAppConfig({ VITE_API_URL: validEnv.VITE_API_URL } as ImportMetaEnv)).toThrow(
      /configuration|VITE_AGENT_MODEL/i,
    )
  })

  it('rejects 0.0.0.0 because it is a bind address, not a browser destination', () => {
    try {
      getAppConfig({ ...validEnv, VITE_API_URL: 'http://0.0.0.0:7000/v1/chat/completions' } as ImportMetaEnv)
    } catch (error) {
      expect(error).toMatchObject({
        category: 'configuration',
        diagnostics: [expect.objectContaining({ code: 'browser-invalid-localhost' })],
      })
      return
    }

    throw new Error('Expected VITE_API_URL=0.0.0.0 to be rejected.')
  })

  it('does not synthesize placeholder auth when no API key is configured', () => {
    const config = getAppConfig(validEnv as ImportMetaEnv)

    expect(config.apiKey).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain('Bearer NONE')
  })

  it('preserves optional auth only when an actual credential is configured', () => {
    expect(
      getAppConfig({ ...validEnv, VITE_AGENT_API_KEY: 'real-token' } as ImportMetaEnv),
    ).toMatchObject({ apiKey: 'real-token' })
  })

  it('keeps frontend contract docs aligned with local chat-completions and optional auth scope', () => {
    expect(agentContract.request.route).toContain('http://localhost:7000/v1/chat/completions')
    expect(agentContract.request.route).toContain('/v1/chat/completions')
    expect(agentContract.auth.localDevelopment).toMatch(/authentication requirements depend on the backend/i)
    expect(agentContract.auth.localDevelopment).toMatch(/optional bearer token/i)
    expect(agentContract.auth.forbiddenPlaceholder).toMatch(/Bearer NONE must never/i)
    expect(agentContract.evidenceScope.frontendOnly).toMatch(/frontend config\/client expectations/i)
    expect(agentContract.evidenceScope.excluded).toMatch(/does not prove backend/i)
  })

  it('applies bounded timeout and max-size defaults', () => {
    expect(getAppConfig(validEnv as ImportMetaEnv)).toMatchObject({
      requestTimeoutMs: 300_000,
      idleTimeoutMs: 120_000,
      maxStreamBytes: expect.any(Number),
    })
  })

  it.each([
    'ftp://agent.example.test/generate',
    'file:///tmp/agent',
    'https://user:token@agent.example.test/generate',
    'https://agent.example.test/generate#fragment',
    'http://[::]:7000/v1/chat/completions',
  ])('rejects unusable browser endpoints (%s)', (apiUrl) => {
    expect(() => getAppConfig({ ...validEnv, VITE_API_URL: apiUrl } as ImportMetaEnv)).toThrow()
  })

  it.each(['VITE_AGENT_REQUEST_TIMEOUT_MS', 'VITE_AGENT_IDLE_TIMEOUT_MS', 'VITE_AGENT_MAX_STREAM_BYTES'])('requires positive integers for %s', (key) => {
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', true, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => getAppConfig({ ...validEnv, [key]: value } as ImportMetaEnv)).toThrow()
    }
  })

  it('rejects timeouts that overflow browser timers', () => {
    for (const key of ['VITE_AGENT_REQUEST_TIMEOUT_MS', 'VITE_AGENT_IDLE_TIMEOUT_MS']) {
      expect(() => getAppConfig({ ...validEnv, [key]: '2147483648' } as ImportMetaEnv)).toThrow()
    }
  })
})
