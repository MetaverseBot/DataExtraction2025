export const APP_AUTH_COOKIE = "aapasd_owner_session";

const PASSWORD_FALLBACK = "dataextraction";
const SESSION_SECRET_FALLBACK = "local-dev-session-secret-change-me";

export function getPortalPassword(): string {
  return process.env.OWNER_PORTAL_PASSWORD?.trim() || PASSWORD_FALLBACK;
}

export function getSessionSignature(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || SESSION_SECRET_FALLBACK;
  return `aapasd-owner:${secret}`;
}
