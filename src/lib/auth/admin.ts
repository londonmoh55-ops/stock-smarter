/** Hard-coded super-admins (email, lowercased). */
export const ADMIN_EMAILS = ["londonmoh55@gmail.com"] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}
