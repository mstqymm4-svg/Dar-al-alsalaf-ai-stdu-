// Base URL of the backend that serves /api/send-otp, /api/verify-otp,
// /send-contact-message, and /api/youtube-meta.
//
// - In the browser (same origin as the server) leave VITE_API_BASE_URL empty
//   and requests stay relative, e.g. "/api/send-otp".
// - Inside the Android app (Capacitor APK/AAB) the app is served locally
//   from https://localhost or capacitor://localhost, so relative requests would
//   never reach the backend server. If VITE_API_BASE_URL is unset at build time,
//   fall back automatically to the hosted backend URL.
const DEFAULT_REMOTE_API =
  "https://ais-pre-taxhi5e3sszvdhq5syo3ia-174510247368.europe-west3.run.app";

function isCapacitorNativeRuntime() {
  if (typeof window === "undefined") return false;
  try {
    if (window.Capacitor?.isNativePlatform?.()) return true;
    const { protocol, hostname, port } = window.location || {};
    if (protocol === "capacitor:" || protocol === "ionic:" || protocol === "file:") {
      return true;
    }
    if (hostname === "localhost" && !port) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

const envBase = (import.meta.env.VITE_API_BASE_URL || "").trim();
const resolvedBase = envBase || (isCapacitorNativeRuntime() ? DEFAULT_REMOTE_API : "");

export const API_BASE = resolvedBase.replace(/\/+$/, "");

export const apiUrl = (path) => {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
};
