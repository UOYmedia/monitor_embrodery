import { describe, expect, it } from 'vitest'
import { AuthorizationError, assertPermission, can, permissions, resolveActor, sessionSummary } from './authz.mjs'

const tokenConfig = {
  auth: {
    mode: 'token',
    localActor: 'local-admin',
    tokens: [
      { id: 't-view', actor: 'quan-doc-a', role: 'viewer', token: 'viewer-token-0123456789' },
      { id: 't-tech', actor: 'ky-thuat-b', role: 'technician', token: 'tech-token-0123456789ab' },
    ],
  },
}
const localConfig = { auth: { mode: 'single-admin', localActor: 'local-admin', tokens: [] } }
const withToken = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} })

describe('permission map', () => {
  it('gives viewers read access only', () => {
    const viewerCan = Object.keys(permissions).filter((permission) => can('viewer', permission))
    expect(viewerCan.sort()).toEqual(['audit:read', 'fleet:read'])
  })

  it('reserves site, user and retention management for admins', () => {
    for (const permission of ['site:manage', 'user:manage', 'retention:manage']) {
      expect(can('technician', permission)).toBe(false)
      expect(can('admin', permission)).toBe(true)
    }
  })

  it('lets technicians run every day-to-day mutation', () => {
    for (const permission of ['scan:run', 'machine:pair', 'machine:update', 'machine:archive', 'machine:probe', 'alert:acknowledge', 'maintenance:complete']) {
      expect(can('technician', permission)).toBe(true)
    }
  })

  it('throws on an unknown permission instead of silently allowing it', () => {
    expect(() => can('admin', 'machine:start')).toThrow(/Quyền không xác định/)
  })
})

describe('resolveActor', () => {
  it('treats every caller as the configured local admin in single-admin mode', () => {
    expect(resolveActor(withToken(null), localConfig)).toMatchObject({ actor: 'local-admin', role: 'admin', authenticated: true })
  })

  it('maps a bearer token to a named person and role', () => {
    expect(resolveActor(withToken('tech-token-0123456789ab'), tokenConfig)).toMatchObject({ actor: 'ky-thuat-b', role: 'technician', authenticated: true })
  })

  it('returns an unauthenticated actor for a missing or wrong token', () => {
    expect(resolveActor(withToken(null), tokenConfig)).toMatchObject({ actor: 'anonymous', role: null, authenticated: false })
    expect(resolveActor(withToken('sai-token-0123456789ab'), tokenConfig)).toMatchObject({ authenticated: false })
    expect(resolveActor(withToken('viewer-token-0123456789 '), tokenConfig)).toMatchObject({ actor: 'quan-doc-a' })
  })
})

describe('assertPermission', () => {
  it('blocks a viewer from every mutation with 403', () => {
    const viewer = resolveActor(withToken('viewer-token-0123456789'), tokenConfig)
    for (const permission of ['machine:pair', 'machine:update', 'machine:archive', 'scan:run', 'alert:acknowledge', 'maintenance:complete']) {
      expect(() => assertPermission(viewer, permission)).toThrow(AuthorizationError)
      try { assertPermission(viewer, permission) } catch (error) { expect(error.status).toBe(403) }
    }
    expect(() => assertPermission(viewer, 'fleet:read')).not.toThrow()
  })

  it('answers 401, not 403, when nobody is authenticated', () => {
    try {
      assertPermission(resolveActor(withToken(null), tokenConfig), 'fleet:read')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.status).toBe(401)
    }
  })
})

describe('sessionSummary', () => {
  it('tells the UI exactly which controls to show', () => {
    const summary = sessionSummary(resolveActor(withToken('viewer-token-0123456789'), tokenConfig))
    expect(summary).toMatchObject({ actor: 'quan-doc-a', role: 'viewer', authMode: 'token', authenticated: true })
    expect(summary.permissions).not.toContain('machine:pair')
  })
})
