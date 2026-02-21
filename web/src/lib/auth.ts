function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAllowedOwnerEmails(): string[] {
  const raw = process.env.ALLOWED_OWNER_EMAILS ?? "";
  return raw
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter((item) => item.length > 0);
}

export function isAllowedOwnerEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const normalized = normalizeEmail(email);
  const allowlist = getAllowedOwnerEmails();
  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.includes(normalized);
}
