/**
 * Independent API client configuration.
 *
 * Reads VITE_API_URL and an opt-in flag VITE_USE_INDEPENDENT_API.
 * The flag lets the app keep using Base44 in the live preview while the
 * independent backend is being deployed; flip it to "true" once the
 * backend is live to route the frontend through this layer.
 */

const viteEnv: Record<string, string | undefined> = ((import.meta as any).env) || {};
const BASE_URL = viteEnv.VITE_API_URL?.replace(/\/$/, "") || "/api";

export const INDEPENDENT_API_ENABLED =
  String(viteEnv.VITE_USE_INDEPENDENT_API || "false") === "true";

const TOKEN_KEY = "dau_access_token";
const REFRESH_KEY = "dau_refresh_token";

export const tokenStore = {
  get access() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  },
  get refresh() {
    try { return localStorage.getItem(REFRESH_KEY) || ""; } catch { return ""; }
  },
  set(access: string, refresh?: string) {
    try {
      localStorage.setItem(TOKEN_KEY, access);
      if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {}
  },
};

export { BASE_URL };