import { auth, db, base44 } from "./base44Client";

export const BOOTSTRAP_ADMIN_EMAIL = "mstqymm4@gmail.com";

export function isBootstrapAdmin(fbUser) {
  if (!fbUser) return false;
  const isAdminEmail = !!fbUser.emailVerified && !!fbUser.email && fbUser.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  return isAdminEmail;
}

export function checkAdminSession(fbUser) {
  if (!fbUser) return false;
  const isAdminEmail = !!fbUser.emailVerified && !!fbUser.email && fbUser.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  return isAdminEmail;
}

export { auth, db, base44 };
export default base44;
