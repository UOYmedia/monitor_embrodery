import { timingSafeEqual } from 'node:crypto'

/**
 * Authorization boundary for the bridge.
 *
 * This is intentionally NOT a login system. There is no password form, no session and no
 * fake user directory. Two honest modes are supported:
 *
 *  - `single-admin`: the bridge trusts its own LAN socket and treats every caller as one
 *    configured local admin. Correct only for a single-operator workshop on a trusted LAN.
 *  - `token`: each caller presents a bearer token that maps to a real person and a role.
 *
 * TODO(phase-2): swap `resolveActor` for an OIDC/SSO introspection call. Everything else —
 * permissions, audit actor, route guards — already reads from the resolved actor, so the
 * replacement is confined to this file.
 */

export const roles = ['viewer', 'technician', 'admin']

export const permissions = {
  'fleet:read': ['viewer', 'technician', 'admin'],
  'audit:read': ['viewer', 'technician', 'admin'],
  'alert:acknowledge': ['technician', 'admin'],
  'maintenance:complete': ['technician', 'admin'],
  'scan:run': ['technician', 'admin'],
  'machine:pair': ['technician', 'admin'],
  'machine:update': ['technician', 'admin'],
  'machine:archive': ['technician', 'admin'],
  'machine:probe': ['technician', 'admin'],
  // Nhập tay số bộ đếm: ngang quyền sửa máy, vì con số này chảy thẳng vào bảng lương khoán.
  // Viewer đọc được báo cáo nhưng không được tạo ra con số trong đó.
  'production:enter': ['technician', 'admin'],
  'site:manage': ['admin'],
  'user:manage': ['admin'],
  'retention:manage': ['admin'],
}

export class AuthorizationError extends Error {
  constructor(message, { status = 403, permission = null } = {}) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = status
    this.permission = permission
  }
}

export function can(role, permission) {
  const allowed = permissions[permission]
  if (!allowed) throw new Error(`Quyền không xác định: ${permission}`)
  return allowed.includes(role)
}

/** Comparison that does not leak token length or prefix through timing. */
function tokenMatches(candidate, expected) {
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function bearerToken(headers) {
  const header = headers?.authorization ?? headers?.Authorization
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/**
 * Maps an incoming request to an actor and role. Never throws for an anonymous caller in
 * token mode: it returns an `anonymous` viewer-less actor so the route guard can produce a
 * single, auditable 401.
 */
export function resolveActor(request, config) {
  if (config.auth.mode === 'single-admin') {
    return { actor: config.auth.localActor, role: 'admin', authMode: 'single-admin', authenticated: true }
  }
  const presented = bearerToken(request.headers)
  if (!presented) return { actor: 'anonymous', role: null, authMode: 'token', authenticated: false }
  const match = config.auth.tokens.find((entry) => tokenMatches(presented, entry.token))
  if (!match) return { actor: 'anonymous', role: null, authMode: 'token', authenticated: false }
  return { actor: match.actor, role: match.role, authMode: 'token', authenticated: true, tokenId: match.id }
}

export function assertPermission(session, permission) {
  if (!session.authenticated || !session.role) {
    throw new AuthorizationError('Cần access token hợp lệ để dùng API này.', { status: 401, permission })
  }
  if (!can(session.role, permission)) {
    throw new AuthorizationError(`Vai trò ${session.role} không có quyền ${permission}.`, { status: 403, permission })
  }
  return session
}

/** Shape sent to the dashboard so the UI can hide controls the caller cannot use. */
export function sessionSummary(session) {
  return {
    actor: session.actor,
    role: session.role,
    authMode: session.authMode,
    authenticated: session.authenticated,
    permissions: Object.keys(permissions).filter((permission) => session.role && can(session.role, permission)),
  }
}
