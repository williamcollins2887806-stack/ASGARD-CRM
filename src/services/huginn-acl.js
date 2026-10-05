'use strict';

/**
 * Huginn guest ACL — guests may use messenger APIs only, not CRM modules.
 */

const GUEST_ALLOWED_PREFIXES = [
  '/api/auth/',
  '/api/chat-groups',
  '/api/sse/',
  '/api/stories',
  '/api/push',
  '/api/notifications'
];

/** CRM bridges mounted under /api/chat-groups — never for guests */
const GUEST_DENIED_PATH_RE = [
  /\/chat-groups\/mimir(\/|$)/i,
  /\/chat-groups\/[^/]+\/mimir(-stream)?(\/|$)/i,
  /\/chat-groups\/from-estimate(\/|$)/i,
  /\/chat-groups\/by-entity(\/|$)/i,
  /\/update-estimate/i,
  /\/estimate/i
];

function isHuginnGuest(user) {
  if (!user) return false;
  if (user.is_huginn_guest === true || user.isHuginnGuest === true) return true;
  if (user.role === 'huginn_guest' || user.role === 'HUGINN_GUEST') return true;
  return false;
}

function guestPathDenied(urlPath) {
  const path = String(urlPath || '').split('?')[0];
  return GUEST_DENIED_PATH_RE.some((re) => re.test(path));
}

function guestPathAllowed(urlPath) {
  const path = String(urlPath || '').split('?')[0];
  if (guestPathDenied(path)) return false;
  return GUEST_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p));
}

function assertGuestApiAccess(request, reply) {
  if (!isHuginnGuest(request.user)) return false;
  if (guestPathAllowed(request.url)) return false;
  reply.code(403).send({
    error: 'Forbidden',
    message: 'Гость Хугинна имеет доступ только к мессенджеру'
  });
  return true;
}

function guestJwtClaims(extra = {}) {
  return {
    is_huginn_guest: true,
    pinVerified: true,
    ...extra
  };
}

module.exports = {
  isHuginnGuest,
  guestPathAllowed,
  guestPathDenied,
  assertGuestApiAccess,
  guestJwtClaims,
  GUEST_ALLOWED_PREFIXES
};
