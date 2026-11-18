import { auth, db, base44 } from "./base44Client";

export const BOOTSTRAP_ADMIN_EMAIL = "daraltawhid25@gmail.com";
const ADMIN_EMAILS = new Set(["daraltawhid25@gmail.com", "mstqymm4@gmail.com"]);

export function isBootstrapAdmin(fbUser) {
  if (!fbUser) return false;
  return !!fbUser.emailVerified && !!fbUser.email && ADMIN_EMAILS.has(fbUser.email.toLowerCase());
}

export function checkAdminSession(fbUser) {
  if (!fbUser) return false;
  return !!fbUser.emailVerified && !!fbUser.email && ADMIN_EMAILS.has(fbUser.email.toLowerCase());
}

export { auth, db, base44 };
export default base44;
