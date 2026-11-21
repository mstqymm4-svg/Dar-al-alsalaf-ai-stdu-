import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  getDocFromServer,
  setLogLevel,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import * as offlineDB from "@/lib/offlineDB";
import { sendGmailMessage } from "@/lib/gmailService";

import seedBooks from "../../data-export/Books.json";
import seedVideos from "../../data-export/Videos.json";
import seedVideoChannels from "../../data-export/VideoChannels.json";
import seedSocialChannels from "../../data-export/SocialChannels.json";
import seedAppSettings from "../../data-export/AppSettings.json";
import seedAccountData from "../../data-export/AccountData.json";
import seedTranslationLanguages from "../../data-export/TranslationLanguages.json";
import seedTranslations from "../../data-export/Translations.json";

// ─── Firebase Initialization ──────────────────────────────────────────────────
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
try {
  setLogLevel("silent");
} catch {}

let firestoreDb;
try {
  firestoreDb = initializeFirestore(
    app,
    {
      experimentalAutoDetectLongPolling: true,
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}
export const db = firestoreDb;
export const auth = getAuth(app);

// Validate connection to Firestore on boot (with retry for iframe/WebChannel warm-up)
async function testConnection() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      // Retry once after long-polling auto-detection settles
      await new Promise((r) => setTimeout(r, 2500));
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      try {
        await getDocFromServer(doc(db, "test", "connection"));
      } catch (retryError) {
        if (
          retryError instanceof Error &&
          retryError.message.includes("the client is offline") &&
          (typeof navigator === "undefined" || navigator.onLine !== false)
        ) {
          console.warn("Firestore connection using local offline cache fallback.");
        }
      }
    }
  }
}
setTimeout(testConnection, 2500);

// ─── Firestore Error Handler (Mandatory Schema) ───────────────────────────────
export const OperationType = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  LIST: "list",
  GET: "get",
  WRITE: "write",
};

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ─── Helpers: Sanitization, IDs, Deleted-Seed Tracking ────────────────────────
const OWNER_EMAIL = "daraltawhid25@gmail.com";
const OWNER_EMAILS = new Set(["daraltawhid25@gmail.com", "mstqymm4@gmail.com"]);
const isOwnerAddress = (em) => !!em && OWNER_EMAILS.has(String(em).trim().toLowerCase());
const DELETED_IDS_KEY = "dau_deleted_entity_ids_v1";
const LOCAL_ENTITIES_PREFIX = "dau_entity_store_";
const USER_PROFILE_KEY = "dau_current_user_profile";

function sanitizeId(rawId, prefix = "doc") {
  const str = String(rawId || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
  return str || `${prefix}_${Date.now()}`;
}

const PENDING_CATALOG_OPS_KEY = "dau_pending_catalog_ops_v1";
const WRITE_QUOTA_UNTIL_KEY = "dau_fs_write_quota_until";

function safeNum(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function isQuotaExceededError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  return (
    code === "resource-exhausted" ||
    msg.includes("resource-exhausted") ||
    msg.includes("quota limit exceeded") ||
    msg.includes("quota exceeded")
  );
}

export function markWriteQuotaExhausted() {
  try {
    // Pause cloud writes for 60 minutes (all changes remain persisted locally in localStorage + IndexedDB)
    localStorage.setItem(WRITE_QUOTA_UNTIL_KEY, String(Date.now() + 60 * 60 * 1000));
  } catch {}
}

export function isWriteQuotaExhausted() {
  try {
    const until = Number(localStorage.getItem(WRITE_QUOTA_UNTIL_KEY) || 0);
    if (until > Date.now()) return true;
    if (until > 0) localStorage.removeItem(WRITE_QUOTA_UNTIL_KEY);
  } catch {}
  return false;
}

function canAttemptFirestoreWrite() {
  return (typeof navigator === "undefined" || navigator.onLine !== false) && !isWriteQuotaExhausted();
}

function isNetworkLikeError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (isQuotaExceededError(err)) {
    markWriteQuotaExhausted();
    return true;
  }
  return (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    code === "unavailable" ||
    code === "not-found" ||
    code === "permission-denied" ||
    code === "unauthenticated" ||
    msg.includes("client is offline") ||
    msg.includes("failed to get document because the client is offline") ||
    msg.includes("permission-denied") ||
    msg.includes("missing or insufficient permissions") ||
    msg.includes("not-found") ||
    msg.includes("network")
  );
}

function readPendingCatalogOps() {
  try {
    const raw = localStorage.getItem(PENDING_CATALOG_OPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingCatalogOps(ops) {
  try {
    if (!ops || ops.length === 0) {
      localStorage.removeItem(PENDING_CATALOG_OPS_KEY);
    } else {
      localStorage.setItem(PENDING_CATALOG_OPS_KEY, JSON.stringify(ops));
    }
  } catch {}
}

function enqueueCatalogOp(op) {
  if (!op || op.collectionName === "app_settings") return;
  const ops = readPendingCatalogOps().filter(
    (item) => !(item.collectionName === op.collectionName && item.docId === op.docId)
  );
  ops.push({ ...op, queuedAt: Date.now() });
  writePendingCatalogOps(ops);
}

function clearPendingCatalogOp(collectionName, docId) {
  const ops = readPendingCatalogOps();
  if (ops.length === 0) return;
  const next = ops.filter(
    (item) => !(item.collectionName === collectionName && (item.docId === docId || item.cleanId === docId))
  );
  if (next.length !== ops.length) {
    writePendingCatalogOps(next);
  }
}

function applyPendingOpsToCatalogList(collectionName, remoteList, sanitizeFn) {
  const ops = readPendingCatalogOps().filter((op) => op.collectionName === collectionName);
  if (ops.length === 0) return Array.isArray(remoteList) ? remoteList : [];
  const byId = new Map();
  for (const item of remoteList || []) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const op of ops) {
    if (op.op === "delete") {
      byId.delete(op.docId);
      if (op.cleanId) byId.delete(op.cleanId);
    } else if ((op.op === "create" || op.op === "update") && op.payload) {
      const clean = sanitizeFn(op.payload, byId.get(op.docId) || {});
      byId.set(clean.id, clean);
    }
  }
  return Array.from(byId.values());
}

function truncStr(val, maxBytes, fallback = "") {
  if (val === undefined || val === null) return fallback;
  const str = String(val);
  if (str.length * 3 <= maxBytes) return str;
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  if (!encoder) return str.slice(0, maxBytes);
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return str;
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.subarray(0, cut));
}

function getDeletedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markDeletedId(id) {
  if (!id) return;
  try {
    const set = getDeletedIds();
    set.add(String(id));
    set.add(sanitizeId(id));
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function unmarkDeletedId(id) {
  if (!id) return;
  try {
    const set = getDeletedIds();
    set.delete(String(id));
    set.delete(sanitizeId(id));
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function isVerifiedUser() {
  return Boolean(auth.currentUser && auth.currentUser.emailVerified);
}

function canWriteAdminFirestore() {
  return true;
}

function sortRecords(items, sortExpr, limitCount) {
  const list = Array.isArray(items) ? [...items] : [];
  if (sortExpr && typeof sortExpr === "string") {
    const desc = sortExpr.startsWith("-");
    const field = desc ? sortExpr.slice(1) : sortExpr;
    list.sort((a, b) => {
      const va = a?.[field] ?? "";
      const vb = b?.[field] ?? "";
      if (va === vb) return 0;
      return (va > vb ? 1 : -1) * (desc ? -1 : 1);
    });
  }
  if (limitCount && Number(limitCount) > 0) {
    return list.slice(0, Number(limitCount));
  }
  return list;
}

function filterRecords(items, queryObj) {
  if (!queryObj || typeof queryObj !== "object") return items;
  return items.filter((item) =>
    Object.entries(queryObj).every(([k, v]) => {
      if (v === undefined) return true;
      return item?.[k] === v;
    })
  );
}

// ─── Schema Sanitizers (Match firebase-blueprint.json & firestore.rules) ──────
function parseBookToc(rawToc) {
  if (!rawToc) return [];
  if (Array.isArray(rawToc)) {
    return rawToc.filter((x) => x && !x.isAuto).slice(0, 500);
  }
  if (typeof rawToc === "string") {
    try {
      const parsed = JSON.parse(rawToc);
      return Array.isArray(parsed)
        ? parsed.filter((x) => x && !x.isAuto).slice(0, 500)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeBook(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const id = sanitizeId(merged.id, "book");
  const cleanToc = parseBookToc(merged.toc ?? existing.toc);
  let serializedToc = "";
  if (cleanToc.length > 0) {
    try {
      const json = JSON.stringify(cleanToc);
      if (json.length <= 145000) {
        serializedToc = json;
      }
    } catch {}
  }

  const out = {
    id,
    title: truncStr(merged.title || "بدون عنوان", 500),
    author: truncStr(merged.author || "غير معروف", 300),
    category: truncStr(merged.category || "عام", 200),
    description: truncStr(merged.description ?? "", 5000),
    cover_image: truncStr(merged.cover_image ?? "", 500000),
    pdf_url: truncStr(merged.pdf_url ?? "", 500000),
    pages_count:
      merged.pages_count === null || merged.pages_count === undefined || merged.pages_count === ""
        ? null
        : safeNum(merged.pages_count, 0),
    language: truncStr(merged.language || "العربية", 100),
    is_featured: Boolean(merged.is_featured),
    rating: safeNum(merged.rating, 0),
    status: truncStr(merged.status || "published", 50),
    ...(serializedToc ? { toc: serializedToc } : {}),
    created_date: truncStr(existing.created_date || merged.created_date || now, 64),
    updated_date: truncStr(raw?.updated_date || now, 64),
    created_by: truncStr(merged.created_by || auth.currentUser?.email || OWNER_EMAIL, 256),
  };
  return out;
}

function sanitizeVideo(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const id = sanitizeId(merged.id, "video");
  const ytUrl = String(merged.youtube_url ?? "");
  const isShortUrl = ytUrl.includes("/shorts/");
  const rawType = merged.video_type || (isShortUrl ? "short" : "normal");
  const normalizedType = isShortUrl && (rawType === "youtube" || rawType === "normal") ? "short" : rawType;
  return {
    id,
    title: truncStr(merged.title || "فيديو", 500),
    description: truncStr(merged.description ?? "", 5000),
    youtube_url: truncStr(ytUrl, 2000),
    video_url: truncStr(merged.video_url ?? "", 500000),
    video_type: truncStr(normalizedType, 50),
    channel_id: truncStr(merged.channel_id ?? "", 128),
    channel_name: truncStr(merged.channel_name ?? "", 300),
    category: truncStr(merged.category || "عام", 200),
    thumbnail: truncStr(merged.thumbnail ?? "", 500000),
    duration: truncStr(merged.duration ?? "", 50),
    is_featured: Boolean(merged.is_featured),
    visible: merged.visible !== false,
    sort_order: safeNum(merged.sort_order, 0),
    created_date: truncStr(existing.created_date || merged.created_date || now, 64),
    updated_date: truncStr(raw?.updated_date || now, 64),
  };
}

function sanitizeVideoChannel(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const id = sanitizeId(merged.id, "channel");
  return {
    id,
    name: truncStr(merged.name || "قناة", 300),
    channel_logo: truncStr(merged.channel_logo ?? "", 500000),
    description: truncStr(merged.description ?? "", 2000),
    youtube_url: truncStr(merged.youtube_url ?? "", 2000),
    category: truncStr(merged.category || "عام", 200),
    sort_order: safeNum(merged.sort_order, 0),
    visible: merged.visible !== false,
    created_date: truncStr(existing.created_date || merged.created_date || now, 64),
    updated_date: truncStr(raw?.updated_date || now, 64),
  };
}

function sanitizeSocialChannel(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const id = sanitizeId(merged.id, "social");
  return {
    id,
    name: truncStr(merged.name || "قناة تواصل", 300),
    channel_type: truncStr(merged.channel_type || "other", 100),
    url: truncStr(merged.url || "https://example.com", 2000),
    icon_url: truncStr(merged.icon_url ?? "", 500000),
    description: truncStr(merged.description ?? "", 2000),
    sort_order: safeNum(merged.sort_order, 0),
    visible: merged.visible !== false,
    created_date: truncStr(existing.created_date || merged.created_date || now, 64),
    updated_date: truncStr(raw?.updated_date || now, 64),
  };
}

function sanitizeAppSetting(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const key = truncStr(merged.setting_key || merged.id || "setting", 128);
  const id = sanitizeId(key, "set");
  return {
    id,
    setting_key: key,
    setting_value: truncStr(merged.setting_value ?? "", 500000),
    setting_type: truncStr(merged.setting_type || "text", 50),
    description: merged.description ? truncStr(merged.description, 1000) : null,
    changed_by: truncStr(merged.changed_by || auth.currentUser?.email || OWNER_EMAIL, 256),
    previous_value: merged.previous_value ? truncStr(merged.previous_value, 500000) : null,
    created_date: truncStr(existing.created_date || merged.created_date || now, 64),
    updated_date: truncStr(raw?.updated_date || now, 64),
  };
}

// Deduplicate exported AppSettings by setting_key (keeping most recent updated_date)
const dedupedSeedSettings = (() => {
  const map = new Map();
  for (const s of seedAppSettings || []) {
    if (!s?.setting_key) continue;
    const prev = map.get(s.setting_key);
    if (!prev || String(s.updated_date || "") > String(prev.updated_date || "")) {
      map.set(s.setting_key, sanitizeAppSetting({ ...s, id: s.setting_key }));
    }
  }
  return Array.from(map.values());
})();

// ─── Firestore Public Collection Adapter (with Memory + IndexedDB + Seed Sync) ─
function createPublicCatalogEntity({
  collectionName,
  sanitizeFn,
  getCachedAll,
  cacheAll,
  replaceCachedAll,
  deleteCached,
  seedList,
}) {
  let memCache = null;
  let localLoadPromise = null;
  let inFlightFetch = null;
  let realtimeUnsub = null;
  let lastNetworkFetchAt = 0;
  const NETWORK_TTL_MS = 25000;

  const dispatchChanged = () => {
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dau_content_changed", { detail: { entity: collectionName } }));
      }
    } catch {}
  };

  function deduplicateSettingsIfNeeded(items) {
    if (collectionName !== "app_settings" || !Array.isArray(items)) return items;
    const byKey = new Map();
    for (const item of items) {
      if (!item) continue;
      const k = String(item.setting_key || item.id || "");
      if (!k) continue;
      const normalized = sanitizeFn({ ...item, id: k, setting_key: k }, item);
      const prev = byKey.get(k);
      if (!prev || String(normalized.updated_date || "") >= String(prev.updated_date || "")) {
        byKey.set(k, normalized);
      }
    }
    return Array.from(byKey.values());
  }

  function filterDeleted(items) {
    const deleted = getDeletedIds();
    const cleaned = (items || [])
      .filter((item) => item && !deleted.has(String(item.id)) && !deleted.has(sanitizeId(item.id)))
      .map((item) => sanitizeFn(item, item));
    return deduplicateSettingsIfNeeded(cleaned);
  }

  function mergeSeedWithItems(items) {
    if (!seedList || seedList.length === 0) return items || [];
    if (collectionName === "app_settings") {
      return mergeSettingsWithLocal(items || [], (seedList || []).map((x) => sanitizeFn(x)));
    }
    if (!items || items.length === 0) {
      return (seedList || []).map((x) => sanitizeFn(x));
    }
    // Merge seed items that are not in `items` and not deleted
    const deleted = getDeletedIds();
    const byId = new Map();
    for (const s of seedList) {
      const cleanS = sanitizeFn(s);
      if (!deleted.has(String(cleanS.id)) && !deleted.has(sanitizeId(cleanS.id))) {
        byId.set(cleanS.id, cleanS);
      }
    }
    for (const item of items) {
      if (!item) continue;
      const cleanItem = sanitizeFn(item, item);
      byId.set(cleanItem.id, cleanItem);
    }
    return Array.from(byId.values());
  }

  async function loadLocalList() {
    if (memCache && memCache.length > 0) {
      const withPending = applyPendingOpsToCatalogList(collectionName, memCache, sanitizeFn);
      const deleted = getDeletedIds();
      if (deleted.size === 0) return withPending;
      return withPending.filter(
        (item) => item && !deleted.has(String(item.id)) && !deleted.has(sanitizeId(item.id))
      );
    }
    if (localLoadPromise) return localLoadPromise;

    localLoadPromise = (async () => {
      try {
        const cached = await getCachedAll().catch(() => []);
        const base = mergeSeedWithItems(cached);
        const withPending = applyPendingOpsToCatalogList(collectionName, base, sanitizeFn);
        const cleaned = filterDeleted(withPending);
        memCache = cleaned;
        return cleaned;
      } finally {
        localLoadPromise = null;
      }
    })();

    return localLoadPromise;
  }

  // Pre-warm memory cache immediately on startup without blocking
  loadLocalList().catch(() => {});

  async function readServerDoc(rawId, cleanId) {
    try {
      const snap = await Promise.race([
        getDoc(doc(db, collectionName, rawId)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("readServerDoc timeout")), 900)),
      ]);
      if (snap?.exists()) return { docId: snap.id, data: snap.data() };
    } catch {}
    if (cleanId && cleanId !== rawId) {
      try {
        const snap = await Promise.race([
          getDoc(doc(db, collectionName, cleanId)),
          new Promise((_, reject) => setTimeout(() => reject(new Error("readServerDoc timeout")), 900)),
        ]);
        if (snap?.exists()) return { docId: snap.id, data: snap.data() };
      } catch {}
    }
    return null;
  }

  async function flushPendingForThisCollection() {
    if (!canAttemptFirestoreWrite()) return;
    const ops = readPendingCatalogOps().filter((op) => op.collectionName === collectionName);
    if (ops.length === 0) return;

    for (const op of ops) {
      if (!canAttemptFirestoreWrite()) break;
      try {
        if (op.op === "delete") {
          await deleteDoc(doc(db, collectionName, op.docId)).catch((e) => {
            if (isQuotaExceededError(e)) throw e;
          });
          if (op.cleanId && op.cleanId !== op.docId) {
            await deleteDoc(doc(db, collectionName, op.cleanId)).catch((e) => {
              if (isQuotaExceededError(e)) throw e;
            });
          }
          clearPendingCatalogOp(collectionName, op.docId);
        } else if (op.op === "create" || op.op === "update") {
          const serverDoc = await readServerDoc(op.docId, op.cleanId);
          const item = serverDoc
            ? sanitizeFn(
                {
                  ...serverDoc.data,
                  ...op.payload,
                  id: collectionName === "app_settings"
                    ? sanitizeId(op.payload?.setting_key || op.docId, "set")
                    : serverDoc.docId,
                  created_date: serverDoc.data.created_date || op.payload?.created_date,
                  updated_date: op.payload?.updated_date || new Date().toISOString(),
                },
                serverDoc.data
              )
            : sanitizeFn(op.payload);
          await setDoc(doc(db, collectionName, item.id), item);
          clearPendingCatalogOp(collectionName, op.docId);
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          markWriteQuotaExhausted();
          break;
        }
        if (!isNetworkLikeError(err)) {
          clearPendingCatalogOp(collectionName, op.docId);
        }
      }
    }
  }

  function hasListChanged(prevList, nextList) {
    if (!Array.isArray(prevList) || !Array.isArray(nextList)) return true;
    if (prevList.length !== nextList.length) return true;
    const prevMap = new Map();
    for (const item of prevList) {
      if (item?.id) prevMap.set(item.id, `${item.updated_date || ""}|${item.setting_value ?? ""}`);
    }
    for (const item of nextList) {
      if (!prevMap.has(item?.id)) return true;
      if (prevMap.get(item.id) !== `${item.updated_date || ""}|${item.setting_value ?? ""}`) return true;
    }
    return false;
  }

  function mergeSettingsWithLocal(remoteDocs, localDocs) {
    if (collectionName !== "app_settings") return remoteDocs;
    const map = new Map();
    for (const item of localDocs || []) {
      const k = String(item?.setting_key || item?.id || "");
      if (!k) continue;
      map.set(k, sanitizeFn({ ...item, id: k, setting_key: k }, item));
    }
    for (const item of remoteDocs || []) {
      const k = String(item?.setting_key || item?.id || "");
      if (!k) continue;
      const normalized = sanitizeFn({ ...item, id: k, setting_key: k }, item);
      const prev = map.get(k);
      if (!prev || String(normalized.updated_date || "") >= String(prev.updated_date || "")) {
        map.set(k, normalized);
      }
    }
    return Array.from(map.values());
  }

  async function fetchFromFirestore({ notifyOnDiff = false } = {}) {
    if (inFlightFetch) return inFlightFetch;

    inFlightFetch = (async () => {
      const deleted = getDeletedIds();
      try {
        await flushPendingForThisCollection();
        const localBefore = await loadLocalList().catch(() => []);
        const snap = await getDocs(collection(db, collectionName));
        let docs = [];
        snap.forEach((d) => {
          const data = d.data();
          const docId = String(d.id || data?.id);
          if (
            data &&
            !deleted.has(docId) &&
            !deleted.has(String(data?.id || "")) &&
            !deleted.has(sanitizeId(docId))
          ) {
            docs.push(sanitizeFn({ ...data, id: docId }, data));
          }
        });

        docs = deduplicateSettingsIfNeeded(docs);

        // Merge with local/seed so any setting or catalog item not yet in Firestore is preserved!
        docs = mergeSeedWithItems(docs);
        docs = applyPendingOpsToCatalogList(collectionName, docs, sanitizeFn);
        if (collectionName === "app_settings") {
          docs = mergeSettingsWithLocal(docs, localBefore);
        }

        lastNetworkFetchAt = Date.now();
        if (typeof localStorage !== "undefined" && docs.length > 0) {
          localStorage.setItem(`dau_${collectionName}_initialized`, "true");
        }

        const prev = memCache;
        const changed = hasListChanged(prev, docs);
        memCache = docs;

        if (changed) {
          if (typeof replaceCachedAll === "function" && docs.length > 0) {
            replaceCachedAll(docs).catch(() => {});
          } else if (docs.length > 0) {
            cacheAll(docs).catch(() => {});
          }
          if (notifyOnDiff && prev !== null) {
            dispatchChanged();
          }
        }

        return docs;
      } catch (error) {
        return loadLocalList();
      } finally {
        inFlightFetch = null;
      }
    })();

    return inFlightFetch;
  }

  return {
    async list(sort = "-created_date", limit = 1000) {
      const localItems = await loadLocalList();
      if (localItems && localItems.length > 0) {
        if (navigator.onLine && Date.now() - lastNetworkFetchAt > NETWORK_TTL_MS) {
          fetchFromFirestore({ notifyOnDiff: true }).catch(() => {});
        }
        return sortRecords(localItems, sort, limit);
      }
      const items = navigator.onLine ? await fetchFromFirestore() : localItems;
      return sortRecords(items, sort, limit);
    },

    async filter(queryObj = {}, sort = "-created_date", limit = 1000) {
      const all = await this.list(sort, 1000);
      return sortRecords(filterRecords(all, queryObj), sort, limit);
    },

    async get(id) {
      const rawId = String(id);
      const cleanId = sanitizeId(id);
      const deleted = getDeletedIds();
      if (deleted.has(rawId) || deleted.has(cleanId)) return null;

      // Instant lookup from memory / local cache first
      const all = await loadLocalList();
      const localMatch = all.find((x) => x.id === rawId || x.id === cleanId || x.setting_key === id);
      if (localMatch) {
        return localMatch;
      }

      if (navigator.onLine) {
        const serverDoc = await readServerDoc(rawId, cleanId);
        if (serverDoc) {
          const item = sanitizeFn({ ...serverDoc.data, id: serverDoc.docId }, serverDoc.data);
          if (memCache) {
            memCache = deduplicateSettingsIfNeeded([item, ...memCache.filter((x) => x.id !== item.id && (collectionName !== "app_settings" || x.setting_key !== item.setting_key))]);
          }
          cacheAll([item]).catch(() => {});
          return item;
        }
      }
      return null;
    },

    async create(payload) {
      const item = sanitizeFn(payload);
      unmarkDeletedId(item.id);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`dau_${collectionName}_initialized`, "true");
        // Allow explicit admin create actions to attempt Firestore write even if a previous quota timer was set
        localStorage.removeItem(WRITE_QUOTA_UNTIL_KEY);
      }
      // Queue as pending first in localStorage so any concurrent snapshot or list() preserves this item
      enqueueCatalogOp({ collectionName, op: "create", docId: item.id, cleanId: item.id, payload: item });

      const existingList = await loadLocalList().catch(() => []);
      memCache = deduplicateSettingsIfNeeded([
        item,
        ...existingList.filter(
          (x) => x.id !== item.id && (collectionName !== "app_settings" || x.setting_key !== item.setting_key)
        ),
      ]);
      cacheAll([item]).catch(() => {});
      dispatchChanged();

      if (canAttemptFirestoreWrite()) {
        const syncCreateToCloud = async () => {
          try {
            await setDoc(doc(db, collectionName, item.id), item);
            clearPendingCatalogOp(collectionName, item.id);
          } catch (error) {
            if (collectionName === "books" && "toc" in item) {
              try {
                const { toc: _omitToc, ...withoutToc } = item;
                await setDoc(doc(db, collectionName, item.id), withoutToc);
                clearPendingCatalogOp(collectionName, item.id);
                return;
              } catch {}
            }
            if (!isNetworkLikeError(error)) {
              console.warn(`Cloud sync deferred for ${collectionName}/${item.id}:`, error?.message || error);
            }
          }
        };
        // Wait at most 1100ms for immediate cloud confirmation; otherwise finish in background so UI never hangs
        await Promise.race([
          syncCreateToCloud(),
          new Promise((resolve) => setTimeout(resolve, 1100)),
        ]);
      }
      return item;
    },

    async update(id, payload) {
      const rawId = String(id);
      const cleanId = sanitizeId(id);
      let existing = (await this.get(id)) || { id: cleanId };

      const targetId = collectionName === "app_settings"
        ? sanitizeId(payload?.setting_key || existing.setting_key || cleanId, "set")
        : (existing.id || cleanId);

      const updated = sanitizeFn(
        {
          ...existing,
          ...payload,
          id: targetId,
          ...(existing.setting_key ? { setting_key: existing.setting_key } : {}),
          ...(payload?.setting_key ? { setting_key: payload.setting_key } : {}),
          created_date: existing.created_date || new Date().toISOString(),
          updated_date: new Date().toISOString(),
        },
        existing
      );
      unmarkDeletedId(updated.id);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`dau_${collectionName}_initialized`, "true");
        localStorage.removeItem(WRITE_QUOTA_UNTIL_KEY);
      }
      enqueueCatalogOp({ collectionName, op: "update", docId: updated.id, cleanId: updated.id, payload: updated });

      const existingList = await loadLocalList().catch(() => []);
      const filtered = existingList.filter(
        (x) =>
          x.id !== updated.id &&
          x.id !== rawId &&
          x.id !== cleanId &&
          (collectionName !== "app_settings" || x.setting_key !== updated.setting_key)
      );
      memCache = [updated, ...filtered];
      cacheAll([updated]).catch(() => {});
      dispatchChanged();

      if (canAttemptFirestoreWrite()) {
        const syncUpdateToCloud = async () => {
          try {
            await setDoc(doc(db, collectionName, updated.id), updated);
            clearPendingCatalogOp(collectionName, updated.id);
          } catch (error) {
            if (collectionName === "books" && "toc" in updated) {
              try {
                const { toc: _omitToc, ...withoutToc } = updated;
                await setDoc(doc(db, collectionName, updated.id), withoutToc);
                clearPendingCatalogOp(collectionName, updated.id);
                return;
              } catch {}
            }
            if (!isNetworkLikeError(error)) {
              console.warn(`Cloud update deferred for ${collectionName}/${updated.id}:`, error?.message || error);
            }
          }
        };
        await Promise.race([
          syncUpdateToCloud(),
          new Promise((resolve) => setTimeout(resolve, 1100)),
        ]);
      }
      return updated;
    },

    async delete(id) {
      const rawId = String(id);
      const cleanId = sanitizeId(id);
      markDeletedId(rawId);
      markDeletedId(cleanId);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`dau_${collectionName}_initialized`, "true");
      }
      if (memCache) {
        memCache = memCache.filter((x) => x.id !== rawId && x.id !== cleanId);
      }
      enqueueCatalogOp({ collectionName, op: "delete", docId: rawId, cleanId });
      if (deleteCached) {
        deleteCached(rawId).catch(() => {});
        if (cleanId !== rawId) deleteCached(cleanId).catch(() => {});
      }
      dispatchChanged();

      if (canAttemptFirestoreWrite()) {
        const syncDeleteToCloud = async () => {
          let lastErr = null;
          try {
            await deleteDoc(doc(db, collectionName, rawId));
          } catch (error) {
            lastErr = error;
          }
          if (cleanId !== rawId && !isQuotaExceededError(lastErr)) {
            try {
              await deleteDoc(doc(db, collectionName, cleanId));
              lastErr = null;
            } catch (error) {
              lastErr = lastErr || error;
            }
          }
          if (!lastErr) {
            clearPendingCatalogOp(collectionName, rawId);
          } else if (!isNetworkLikeError(lastErr)) {
            console.warn(`Cloud delete deferred for ${collectionName}/${rawId}:`, lastErr?.message || lastErr);
          }
        };
        await Promise.race([
          syncDeleteToCloud(),
          new Promise((resolve) => setTimeout(resolve, 1100)),
        ]);
      }
      return { id: rawId, deleted: true };
    },
    flushPending: flushPendingForThisCollection,
    syncFromServer: () => fetchFromFirestore({ notifyOnDiff: true }),
    subscribeRealtime() {
      if (realtimeUnsub) return realtimeUnsub;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return () => {};
      try {
        realtimeUnsub = onSnapshot(
          collection(db, collectionName),
          async (snap) => {
            const deleted = getDeletedIds();
            let docs = [];
            snap.forEach((d) => {
              const data = d.data();
              const docId = String(d.id || data?.id);
              if (
                data &&
                !deleted.has(docId) &&
                !deleted.has(String(data?.id || "")) &&
                !deleted.has(sanitizeId(docId))
              ) {
                docs.push(sanitizeFn({ ...data, id: docId }, data));
              }
            });

            if (docs.length === 0 && readPendingCatalogOps().filter((op) => op.collectionName === collectionName).length === 0) {
              return;
            }

            docs = deduplicateSettingsIfNeeded(docs);
            docs = mergeSeedWithItems(docs);
            docs = applyPendingOpsToCatalogList(collectionName, docs, sanitizeFn);
            if (collectionName === "app_settings") {
              const localBefore = await loadLocalList().catch(() => []);
              docs = mergeSettingsWithLocal(docs, localBefore);
            }

            lastNetworkFetchAt = Date.now();
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(`dau_${collectionName}_initialized`, "true");
            }

            const prev = memCache;
            const changed = hasListChanged(prev, docs);
            memCache = docs;

            if (changed) {
              if (typeof replaceCachedAll === "function") {
                replaceCachedAll(docs).catch(() => {});
              } else if (docs.length > 0) {
                cacheAll(docs).catch(() => {});
              }
              if (prev !== null) {
                dispatchChanged();
              }
            }
          },
          () => {
            // Ignore transient offline/snapshot errors
          }
        );
      } catch {
        realtimeUnsub = null;
      }
      return () => {
        if (realtimeUnsub) {
          try { realtimeUnsub(); } catch {}
          realtimeUnsub = null;
        }
      };
    },
  };
}

// ─── Favorites Entity (Firestore + IndexedDB) ─────────────────────────────────
let lastFavFetchAt = 0;
let inFlightFavSync = null;

const FavoriteEntity = {
  async list(sort = "-created_date", limit = 1000) {
    const localFavs = await offlineDB.getLocalFavorites().catch(() => []);
    const map = new Map();
    for (const f of localFavs) {
      if (f?.bookId) {
        map.set(f.bookId, {
          id: f.bookId,
          book_id: f.bookId,
          user_email: f.userEmail || auth.currentUser?.email || OWNER_EMAIL,
          created_date: new Date(f.date || Date.now()).toISOString(),
        });
      }
    }

    const syncFromCloud = async () => {
      if (!navigator.onLine || !isVerifiedUser() || !auth.currentUser) return;
      if (inFlightFavSync) return inFlightFavSync;
      inFlightFavSync = (async () => {
        try {
          const q = query(
            collection(db, "favorites"),
            where("ownerUid", "==", auth.currentUser.uid)
          );
          const snap = await getDocs(q);
          lastFavFetchAt = Date.now();
          snap.forEach((d) => {
            const data = d.data();
            if (data?.book_id) {
              const rec = {
                id: data.id || d.id,
                book_id: data.book_id,
                user_email: data.user_email || auth.currentUser?.email || "",
                ownerUid: data.ownerUid,
                created_date: data.created_date || new Date().toISOString(),
              };
              map.set(data.book_id, rec);
              offlineDB.saveLocalFavorite(data.book_id, rec.user_email).catch(() => {});
            }
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
            handleFirestoreError(error, OperationType.LIST, "favorites");
          }
        } finally {
          inFlightFavSync = null;
        }
      })();
      return inFlightFavSync;
    };

    if (map.size > 0) {
      if (Date.now() - lastFavFetchAt > 30000) {
        syncFromCloud().catch(() => {});
      }
      return sortRecords(Array.from(map.values()), sort, limit);
    }

    if (Date.now() - lastFavFetchAt > 30000) {
      await syncFromCloud();
    }
    return sortRecords(Array.from(map.values()), sort, limit);
  },

  async filter(queryObj = {}, sort = "-created_date", limit = 1000) {
    const all = await this.list(sort, 1000);
    return sortRecords(filterRecords(all, queryObj), sort, limit);
  },

  async get(id) {
    const all = await this.list();
    return all.find((f) => f.id === id || f.book_id === id) || null;
  },

  async create(payload) {
    const bookId = sanitizeId(payload?.book_id || payload?.id, "book");
    const userEmail = truncStr(
      payload?.user_email || auth.currentUser?.email || OWNER_EMAIL,
      256
    );
    await offlineDB.saveLocalFavorite(bookId, userEmail).catch(() => {});
    const now = new Date().toISOString();
    const favId = auth.currentUser
      ? sanitizeId(`${auth.currentUser.uid}_${bookId}`, "fav")
      : bookId;
    const record = {
      id: favId,
      book_id: bookId,
      user_email: userEmail,
      ownerUid: auth.currentUser?.uid || "local_user",
      created_date: now,
    };
    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      setDoc(doc(db, "favorites", favId), record).catch((error) => {
        if (isQuotaExceededError(error)) markWriteQuotaExhausted();
      });
    }
    return record;
  },

  async update(id, payload) {
    return { id, ...payload };
  },

  async delete(id) {
    const localFavs = await offlineDB.getLocalFavorites().catch(() => []);
    const found = localFavs.find((f) => f.bookId === id || f.id === id);
    const bookId = found?.bookId || id;
    await offlineDB.removeLocalFavorite(bookId).catch(() => {});
    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      const favId = sanitizeId(`${auth.currentUser.uid}_${bookId}`, "fav");
      deleteDoc(doc(db, "favorites", favId)).catch((error) => {
        if (isQuotaExceededError(error)) markWriteQuotaExhausted();
      });
    }
    return { id, deleted: true };
  },
};

// ─── AccountData Entity (Firestore + localStorage + Seed) ─────────────────────
const ACCOUNT_DATA_LS_KEY = "dau_cloud_account_data_v1";

function getLocalAccountRecords() {
  try {
    const raw = localStorage.getItem(ACCOUNT_DATA_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return Array.isArray(seedAccountData) ? [...seedAccountData] : [];
}

function saveLocalAccountRecords(records) {
  try {
    localStorage.setItem(ACCOUNT_DATA_LS_KEY, JSON.stringify(records));
  } catch {}
}

const AccountDataEntity = {
  async list() {
    const local = getLocalAccountRecords();
    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      try {
        const docId = sanitizeId(auth.currentUser.uid, "acc");
        const snap = await getDoc(doc(db, "account_data", docId));
        if (snap.exists()) {
          const data = snap.data();
          const merged = [
            data,
            ...local.filter((r) => r.account_email !== data.account_email),
          ];
          saveLocalAccountRecords(merged);
          return merged;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
          handleFirestoreError(error, OperationType.GET, "account_data");
        }
      }
    }
    return local;
  },

  async filter(queryObj = {}) {
    const all = await this.list();
    return filterRecords(all, queryObj);
  },

  async get(id) {
    const all = await this.list();
    return all.find((r) => r.id === id) || null;
  },

  async create(payload) {
    const now = new Date().toISOString();
    const docId = auth.currentUser
      ? sanitizeId(auth.currentUser.uid, "acc")
      : sanitizeId(payload?.id || payload?.account_email, "acc");
    const rec = {
      id: docId,
      account_email: truncStr(payload?.account_email || auth.currentUser?.email || OWNER_EMAIL, 256),
      ownerUid: auth.currentUser?.uid || "local_user",
      data: truncStr(payload?.data || "{}", 800000),
      data_version: Number(payload?.data_version) || 1,
      created_date: now,
      updated_date: now,
    };
    const all = getLocalAccountRecords().filter(
      (r) => r.id !== docId && r.account_email !== rec.account_email
    );
    all.unshift(rec);
    saveLocalAccountRecords(all);

    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      try {
        await setDoc(doc(db, "account_data", docId), rec);
      } catch (error) {
        if (!isNetworkLikeError(error)) {
          handleFirestoreError(error, OperationType.CREATE, `account_data/${docId}`);
        }
      }
    }
    return rec;
  },

  async update(id, payload) {
    const all = getLocalAccountRecords();
    const existing = all.find((r) => r.id === id) || all[0] || {};
    const now = new Date().toISOString();
    const docId = auth.currentUser
      ? sanitizeId(auth.currentUser.uid, "acc")
      : sanitizeId(id || existing.id, "acc");
    let serverData = null;
    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      try {
        const snap = await getDoc(doc(db, "account_data", docId));
        if (snap.exists()) serverData = snap.data();
      } catch {}
    }
    const updated = {
      id: docId,
      account_email: truncStr(
        serverData?.account_email || existing.account_email || payload?.account_email || auth.currentUser?.email || OWNER_EMAIL,
        256
      ),
      ownerUid: serverData?.ownerUid || auth.currentUser?.uid || existing.ownerUid || "local_user",
      data: truncStr(payload?.data ?? existing.data ?? "{}", 800000),
      data_version: Number(payload?.data_version ?? existing.data_version) || 1,
      created_date: truncStr(serverData?.created_date || existing.created_date || now, 64),
      updated_date: now,
    };
    const next = [
      updated,
      ...all.filter((r) => r.id !== id && r.id !== docId && r.account_email !== updated.account_email),
    ];
    saveLocalAccountRecords(next);

    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      try {
        await setDoc(doc(db, "account_data", docId), updated);
      } catch (error) {
        if (!isNetworkLikeError(error)) {
          handleFirestoreError(error, OperationType.UPDATE, `account_data/${docId}`);
        }
      }
    }
    return updated;
  },

  async delete(id) {
    const next = getLocalAccountRecords().filter((r) => r.id !== id);
    saveLocalAccountRecords(next);
    if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
      const docId = sanitizeId(auth.currentUser.uid, "acc");
      try {
        await deleteDoc(doc(db, "account_data", docId));
      } catch (error) {
        if (isQuotaExceededError(error)) markWriteQuotaExhausted();
      }
    }
    return { id, deleted: true };
  },
};

// ─── Generic Local + Seed Entity Factory (Users, Authors, Categories, etc.) ───
function createLocalBackedEntity(storeName, initialSeed = []) {
  const storageKey = `${LOCAL_ENTITIES_PREFIX}${storeName}`;

  function readAll() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return Array.isArray(initialSeed) ? [...initialSeed] : [];
  }

  function writeAll(list) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
    } catch {}
  }

  return {
    async list(sort = "-created_date", limit = 1000) {
      return sortRecords(readAll(), sort, limit);
    },
    async filter(queryObj = {}, sort = "-created_date", limit = 1000) {
      return sortRecords(filterRecords(readAll(), queryObj), sort, limit);
    },
    async get(id) {
      return readAll().find((x) => x.id === id) || null;
    },
    async create(payload) {
      const now = new Date().toISOString();
      const item = {
        ...payload,
        id: sanitizeId(payload?.id, storeName.toLowerCase()),
        created_date: payload?.created_date || now,
        updated_date: now,
      };
      const all = readAll().filter((x) => x.id !== item.id);
      all.unshift(item);
      writeAll(all);
      return item;
    },
    async update(id, payload) {
      const all = readAll();
      const idx = all.findIndex((x) => x.id === id);
      const now = new Date().toISOString();
      const updated = {
        ...(idx >= 0 ? all[idx] : { id }),
        ...payload,
        id,
        updated_date: now,
      };
      if (idx >= 0) all[idx] = updated;
      else all.unshift(updated);
      writeAll(all);
      return updated;
    },
    async delete(id) {
      writeAll(readAll().filter((x) => x.id !== id));
      return { id, deleted: true };
    },
  };
}

// ─── User / Auth Management ───────────────────────────────────────────────────
const DEFAULT_OWNER_USER = {
  id: "owner_mstqymm4",
  uid: "owner_mstqymm4",
  email: OWNER_EMAIL,
  full_name: "محمد هارون نور",
  role: "admin",
  notifications_enabled: true,
  preferred_language: "العربية",
  avatar_url: "",
  created_date: "2026-07-01T00:00:00.000Z",
  updated_date: new Date().toISOString(),
};

const UserEntity = createLocalBackedEntity("User", [DEFAULT_OWNER_USER]);

function readCurrentUserProfile() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("dau_logged_out") === "true" && !auth.currentUser) {
      return null;
    }
  } catch {}

  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  const savedEmail = (() => {
    try {
      return localStorage.getItem("dau_account_email") || "";
    } catch {
      return "";
    }
  })();

  const savedName = (() => {
    try {
      return localStorage.getItem("dau_full_name") || "";
    } catch {
      return "";
    }
  })();

  if (!savedEmail && !auth.currentUser?.email) {
    return null;
  }

  const effectiveEmail = savedEmail || auth.currentUser?.email || "";
  if (!effectiveEmail) return null;

  return {
    ...DEFAULT_OWNER_USER,
    id: auth.currentUser?.uid ? sanitizeId(auth.currentUser.uid, "usr") : "usr_current",
    uid: auth.currentUser?.uid ? sanitizeId(auth.currentUser.uid, "usr") : "usr_current",
    email: effectiveEmail,
    full_name: savedName || auth.currentUser?.displayName || (effectiveEmail.split("@")[0]) || DEFAULT_OWNER_USER.full_name,
  };
}

function writeCurrentUserProfile(profile) {
  try {
    if (!profile) {
      localStorage.removeItem(USER_PROFILE_KEY);
      localStorage.removeItem("dau_full_name");
      localStorage.removeItem("dau_account_email");
      return;
    }
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    if (profile?.full_name) localStorage.setItem("dau_full_name", profile.full_name);
    if (profile?.email) localStorage.setItem("dau_account_email", profile.email);
  } catch {}
}

// Keep user profile synced when Firebase Auth state changes
onAuthStateChanged(auth, async (fbUser) => {
  if (!fbUser) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("dau-email-change"));
      window.dispatchEvent(new Event("dau-email-verified"));
    }
    return;
  }
  try {
    localStorage.removeItem("dau_logged_out");
  } catch {}
  const current = readCurrentUserProfile() || {};
  const isOwner =
    !!fbUser.emailVerified && isOwnerAddress(fbUser.email);
  const now = new Date().toISOString();
  const syncedProfile = {
    id: sanitizeId(fbUser.uid, "usr"),
    uid: sanitizeId(fbUser.uid, "usr"),
    email: truncStr(fbUser.email || current.email || "", 256),
    full_name: truncStr(
      fbUser.displayName || current.full_name || "مستخدم DAR AL TAWHID",
      200
    ),
    role: isOwner ? "admin" : current.role || "user",
    notifications_enabled: current.notifications_enabled ?? true,
    preferred_language: truncStr(current.preferred_language || "العربية", 64),
    avatar_url: truncStr(fbUser.photoURL || current.avatar_url || "", 500000),
    created_date: truncStr(current.created_date || now, 64),
    updated_date: now,
  };
  writeCurrentUserProfile(syncedProfile);
  await UserEntity.update(syncedProfile.id, syncedProfile).catch(() => {});

  if (navigator.onLine && fbUser.emailVerified) {
    if (canAttemptFirestoreWrite()) {
      try {
        const userRef = doc(db, "users", syncedProfile.id);
        const snap = await getDoc(userRef);
        const serverUser = snap.exists() ? snap.data() : null;
        const needsWrite =
          !serverUser ||
          serverUser.email !== syncedProfile.email ||
          serverUser.full_name !== syncedProfile.full_name ||
          (isOwner && serverUser.role !== "admin");
        if (needsWrite) {
          const toSave = serverUser
            ? {
                ...syncedProfile,
                id: serverUser.id || syncedProfile.id,
                uid: serverUser.uid || syncedProfile.uid,
                email: serverUser.email || syncedProfile.email,
                role: isOwner ? "admin" : serverUser.role || syncedProfile.role,
                created_date: serverUser.created_date || syncedProfile.created_date,
              }
            : syncedProfile;
          await setDoc(userRef, toSave);
        }
      } catch (err) {
        if (isQuotaExceededError(err)) markWriteQuotaExhausted();
      }
    }
    if (isOwner) {
      Promise.allSettled([
        BookEntity.list(),
        VideoEntity.list(),
        VideoChannelEntity.list(),
        SocialChannelEntity.list(),
        AppSettingsEntity.list(),
      ]).catch(() => {});
    }
  }
});

// ─── File Upload Helper (Compressed Image DataURL & IndexedDB PDF Storage) ────
async function compressImageToDataUrl(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("فشل قراءة الملف"));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
        resolve(String(dataUrl));
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(String(dataUrl));
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim && String(dataUrl).length <= 350000) {
          resolve(String(dataUrl));
          return;
        }
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const compressed = canvas.toDataURL(outType, quality);
        resolve(compressed.length < String(dataUrl).length ? compressed : String(dataUrl));
      };
      img.src = String(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

function uint8ToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

const FIRESTORE_PDF_PREFIX = "firestore://book_files/";
const PDF_CHUNK_RAW_BYTES = 420 * 1024; // ~560KB base64 per Firestore document (<1MB limit)

export async function fetchFirestorePdfBuffer(pdfUrl, onProgress, metadata = {}) {
  if (!pdfUrl || !String(pdfUrl).startsWith(FIRESTORE_PDF_PREFIX)) {
    throw new Error("Invalid cloud PDF reference");
  }

  // 1. Check local IndexedDB cache first (by exact url, bookId, or normalized title)
  try {
    const matched = await offlineDB.findCachedPdfForBook({
      url: pdfUrl,
      bookId: metadata?.bookId,
      title: metadata?.title,
    });
    if (matched?.buffer && matched.buffer.byteLength > 0) {
      const repairedCached = await repairTruncatedPdfBuffer(matched.buffer);
      if (repairedCached.byteLength !== matched.buffer.byteLength) {
        await offlineDB.cachePdf(pdfUrl, repairedCached, metadata?.bookId || pdfUrl, matched.title || metadata?.title || "book.pdf").catch(() => {});
      }
      return repairedCached;
    }
  } catch {}

  const fileId = sanitizeId(String(pdfUrl).slice(FIRESTORE_PDF_PREFIX.length), "pdf");
  let snap;
  try {
    const q = query(collection(db, "book_files"), where("file_id", "==", fileId));
    snap = await getDocs(q);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new Error("تعذر تحميل ملف PDF من السحابة بسبب تجاوز حصة القراءة اليومية المجانية لـ Firestore. يرجى فتح الكتاب من المتصفح الذي تم رفع الملف منه أو إعادة المحاولة بعد تجدد الحصة.");
    }
    throw err;
  }

  const chunkMap = new Map();
  let expectedTotal = 0;
  let expectedSize = 0;
  let fileName = metadata?.title || "book.pdf";

  if (snap && !snap.empty) {
    snap.forEach((d) => {
      const data = d.data();
      if (data && typeof data.chunk_index === "number" && typeof data.chunk_data === "string") {
        chunkMap.set(data.chunk_index, data);
        if (data.total_chunks) expectedTotal = data.total_chunks;
        if (data.size_bytes) expectedSize = data.size_bytes;
        if (data.file_name) fileName = data.file_name;
      }
    });
  }

  // Fallback recovery: if chunks under this fileId are missing or incomplete, recover matching chunks from book_files
  if (chunkMap.size === 0 || (expectedTotal > 0 && chunkMap.size < expectedTotal)) {
    try {
      const allSnap = await getDocs(collection(db, "book_files"));
      const normMetaTitle = String(metadata?.title || "")
        .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
        .replace(/\.pdf$/i, "")
        .trim();
      allSnap.forEach((d) => {
        const data = d.data();
        if (
          data &&
          typeof data.chunk_index === "number" &&
          typeof data.chunk_data === "string"
        ) {
          const normFileName = String(data.file_name || "")
            .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
            .replace(/\.pdf$/i, "")
            .trim();
          const matchesTitle =
            !normMetaTitle ||
            !normFileName ||
            normFileName.includes(normMetaTitle) ||
            normMetaTitle.includes(normFileName);
          if (matchesTitle && !chunkMap.has(data.chunk_index)) {
            chunkMap.set(data.chunk_index, data);
            if (!expectedTotal && data.total_chunks) expectedTotal = data.total_chunks;
            if (!expectedSize && data.size_bytes) expectedSize = data.size_bytes;
            if (data.file_name) fileName = data.file_name;
          }
        }
      });
    } catch {}
  }

  if (chunkMap.size === 0) {
    throw new Error("لم يتم العثور على ملف الكتاب في التخزين السحابي. يرجى إعادة رفع ملف PDF من لوحة الإدارة.");
  }

  const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b);
  const decodedParts = [];
  let totalBytes = 0;
  for (let i = 0; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i];
    const chunkDoc = chunkMap.get(idx);
    const part = base64ToUint8(chunkDoc.chunk_data);
    decodedParts.push(part);
    totalBytes += part.byteLength;
    onProgress?.({
      received: totalBytes,
      total: expectedSize || totalBytes,
      percent: Math.round(((i + 1) / (expectedTotal || sortedIndices.length)) * 100),
    });
  }

  let merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of decodedParts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }

  // Always validate & reconstruct trailer if chunks were partially uploaded or missing trailing xref/%%EOF
  const isPartial = expectedTotal > 0 && chunkMap.size < expectedTotal;
  const finalBuffer = await repairTruncatedPdfBuffer(merged, { force: isPartial });

  await offlineDB.cachePdf(pdfUrl, finalBuffer, metadata?.bookId || pdfUrl, fileName).catch(() => {});
  return finalBuffer;
}

async function decompressFlateBytes(compressedUint8) {
  if (typeof DecompressionStream === "undefined") return null;
  for (const format of ["deflate", "deflate-raw"]) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      writer.write(compressedUint8).catch(() => {});
      writer.close().catch(() => {});
      const reader = ds.readable.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      if (total > 0) {
        const out = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) {
          out.set(c, pos);
          pos += c.byteLength;
        }
        return out;
      }
    } catch {}
  }
  return null;
}

export async function repairTruncatedPdfBuffer(input, options = {}) {
  const isArrayBuffer = input instanceof ArrayBuffer;
  const uint8 = isArrayBuffer
    ? new Uint8Array(input)
    : input instanceof Uint8Array
    ? input
    : new Uint8Array(input?.buffer || new ArrayBuffer(0));
  if (uint8.length < 32) return isArrayBuffer ? uint8.buffer : uint8;

  try {
    const decoder = new TextDecoder("latin1");
    const encoder = new TextEncoder();

    const headStr = decoder.decode(uint8.subarray(0, Math.min(2048, uint8.length)));
    if (!headStr.includes("%PDF-")) {
      return isArrayBuffer ? uint8.buffer : uint8;
    }

    const tailStr = decoder.decode(uint8.subarray(Math.max(0, uint8.length - 2048)));
    const hasValidEof =
      tailStr.includes("%%EOF") &&
      tailStr.includes("startxref") &&
      !tailStr.includes("DAR_REPAIRED_EOF");
    if (hasValidEof && !options.force) {
      return isArrayBuffer ? uint8.buffer : uint8;
    }

    let fullText = decoder.decode(uint8);
    // Strip any older repair suffix if force-repairing
    const prevRepairMarker = fullText.indexOf("%DAR_REPAIR_START%");
    if (prevRepairMarker > 0) {
      fullText = fullText.slice(0, prevRepairMarker);
    }

    const lastEndObj = fullText.lastIndexOf("endobj");
    const cleanByteLen = lastEndObj >= 0 ? lastEndObj + 6 : fullText.length;

    // Clone prefix bytes so we can neutralize /Linearized and /XRef without shifting byte offsets
    const prefixBytes = uint8.slice(0, cleanByteLen);
    let cleanText = fullText.slice(0, cleanByteLen);

    // CRITICAL FIX 1: PDF.js checks the first 1024 bytes for `/Linearized` and jumps to the broken
    // first-page xref instead of reading `startxref` at the end of the file!
    // Replacing `/Linearized` -> `/Linearize_` (11 bytes -> 11 bytes) and `/XRef` -> `/XRe_` (5 bytes -> 5 bytes)
    // preserves 100% of byte offsets while forcing PDF.js to use our reconstructed xref table at the end.
    const linRegex = /\/Linearized\b/g;
    let lm;
    while ((lm = linRegex.exec(cleanText)) !== null) {
      prefixBytes[lm.index + 10] = 0x5f; // '_'
    }
    const xrefStreamRegex = /\/Type\s*\/XRef\b/g;
    while ((lm = xrefStreamRegex.exec(cleanText)) !== null) {
      const xIdx = cleanText.indexOf("/XRef", lm.index);
      if (xIdx >= 0) {
        prefixBytes[xIdx + 4] = 0x5f; // '/XRe_'
      }
    }
    cleanText = decoder.decode(prefixBytes);

    // Collect all complete indirect objects
    const objRegex = /(?:^|\r|\n)(\d+)\s+(\d+)\s+obj\b/g;
    const objOffsets = new Map();
    const objStarts = [];
    let m;
    while ((m = objRegex.exec(cleanText)) !== null) {
      const id = Number(m[1]);
      const pos = m.index + (m[0].startsWith("\r") || m[0].startsWith("\n") ? 1 : 0);
      objOffsets.set(id, pos);
      objStarts.push({ id, pos });
    }

    const pageIds = [];
    const pageIdSet = new Set();
    const imageObjs = [];
    const objStmEntries = [];
    let maxObjId = 1;

    for (let i = 0; i < objStarts.length; i++) {
      const { id, pos } = objStarts[i];
      if (id > maxObjId) maxObjId = id;
      const nextPos = i + 1 < objStarts.length ? objStarts[i + 1].pos : cleanByteLen;
      const objSlice = cleanText.slice(pos, Math.min(nextPos, pos + 131072));
      const streamIdx = objSlice.indexOf("stream");
      const dictText = streamIdx > 0 ? objSlice.slice(0, streamIdx) : objSlice;

      if (/\/Type\s*\/Page\b(?![a-zA-Z])/i.test(dictText)) {
        if (!pageIdSet.has(id)) {
          pageIdSet.add(id);
          pageIds.push(id);
        }
      } else if (/\/Type\s*\/ObjStm\b/i.test(dictText) && streamIdx > 0) {
        const firstMatch = dictText.match(/\/First\s+(\d+)/);
        if (firstMatch) {
          const firstOffset = Number(firstMatch[1]);
          let dataStart = pos + streamIdx + 6;
          if (prefixBytes[dataStart] === 0x0d && prefixBytes[dataStart + 1] === 0x0a) dataStart += 2;
          else if (prefixBytes[dataStart] === 0x0a || prefixBytes[dataStart] === 0x0d) dataStart += 1;
          const endStreamIdx = objSlice.indexOf("endstream", streamIdx + 6);
          if (endStreamIdx > 0) {
            let dataEnd = pos + endStreamIdx;
            while (
              dataEnd > dataStart &&
              (prefixBytes[dataEnd - 1] === 0x0a || prefixBytes[dataEnd - 1] === 0x0d)
            ) {
              dataEnd--;
            }
            objStmEntries.push({
              id,
              firstOffset,
              isFlate: /\/FlateDecode\b/i.test(dictText),
              bytes: prefixBytes.subarray(dataStart, dataEnd),
            });
          }
        }
      } else if (/\/Subtype\s*\/Image\b/i.test(dictText)) {
        const wMatch = dictText.match(/\/Width\s+(\d+)/);
        const hMatch = dictText.match(/\/Height\s+(\d+)/);
        imageObjs.push({
          id,
          width: wMatch ? Number(wMatch[1]) : 595,
          height: hMatch ? Number(hMatch[1]) : 842,
        });
      }
    }

    // CRITICAL FIX 2: Unpack compressed Object Streams (/Type /ObjStm) so compressed /Type /Page objects become accessible
    let extraObjsStr = "\n%DAR_REPAIR_START%\n";
    if (objStmEntries.length > 0) {
      for (const stm of objStmEntries) {
        const rawBytes = stm.isFlate ? await decompressFlateBytes(stm.bytes) : stm.bytes;
        if (!rawBytes || rawBytes.length <= stm.firstOffset) continue;
        const stmText = decoder.decode(rawBytes);
        const headerPart = stmText.slice(0, stm.firstOffset).trim();
        const bodyPart = stmText.slice(stm.firstOffset);
        const tokens = headerPart.split(/\s+/).map(Number);
        const pairs = [];
        for (let k = 0; k + 1 < tokens.length; k += 2) {
          if (Number.isFinite(tokens[k]) && Number.isFinite(tokens[k + 1])) {
            pairs.push({ objId: tokens[k], relOffset: tokens[k + 1] });
          }
        }
        for (let k = 0; k < pairs.length; k++) {
          const { objId, relOffset } = pairs[k];
          const nextRel = k + 1 < pairs.length ? pairs[k + 1].relOffset : bodyPart.length;
          if (relOffset < 0 || relOffset >= bodyPart.length) continue;
          const objContent = bodyPart.slice(relOffset, nextRel).trim();
          if (!objContent) continue;
          if (objId > maxObjId) maxObjId = objId;

          const thisObjOffset = cleanByteLen + extraObjsStr.length;
          const unwrappedObj = `${objId} 0 obj\n${objContent}\nendobj\n`;
          extraObjsStr += unwrappedObj;
          objOffsets.set(objId, thisObjOffset);

          if (/\/Type\s*\/Page\b(?![a-zA-Z])/i.test(objContent) && !pageIdSet.has(objId)) {
            pageIdSet.add(objId);
            pageIds.push(objId);
          }
        }
      }
    }

    // CRITICAL FIX 3: If the PDF is a scanned book where all /Type /Page dictionaries were at the truncated end
    // of the file, synthesize a valid /Type /Page for each complete scanned page image (/Subtype /Image) found!
    if (pageIds.length === 0 && imageObjs.length > 0) {
      for (const img of imageObjs) {
        const contentObjId = ++maxObjId;
        const pageObjId = ++maxObjId;
        const pageW = 595;
        const pageH = Math.round((img.height / Math.max(1, img.width)) * 595) || 842;
        const streamCmd = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im${img.id} Do Q`;

        const contentOffset = cleanByteLen + extraObjsStr.length;
        const contentObj = `${contentObjId} 0 obj\n<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}\nendstream\nendobj\n`;
        extraObjsStr += contentObj;
        objOffsets.set(contentObjId, contentOffset);

        const pageOffset = cleanByteLen + extraObjsStr.length;
        const pageObj = `${pageObjId} 0 obj\n<< /Type /Page /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${img.id} ${img.id} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`;
        extraObjsStr += pageObj;
        objOffsets.set(pageObjId, pageOffset);
        pageIds.push(pageObjId);
      }
    }

    // CRITICAL FIX 4: If still 0 pages exist, synthesize 1 valid fallback page so PDF.js never throws InvalidPDFException
    if (pageIds.length === 0) {
      const pageObjId = ++maxObjId;
      const pageOffset = cleanByteLen + extraObjsStr.length;
      const pageObj = `${pageObjId} 0 obj\n<< /Type /Page /MediaBox [0 0 595 842] /Resources << >> >>\nendobj\n`;
      extraObjsStr += pageObj;
      objOffsets.set(pageObjId, pageOffset);
      pageIds.push(pageObjId);
    }

    const pagesObjId = ++maxObjId;
    const catalogObjId = ++maxObjId;
    const kidsRefs = pageIds.map((pid) => `${pid} 0 R`).join(" ");

    const pagesObjOffset = cleanByteLen + extraObjsStr.length;
    const pagesObjStr = `${pagesObjId} 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${pageIds.length} >>\nendobj\n`;
    extraObjsStr += pagesObjStr;
    objOffsets.set(pagesObjId, pagesObjOffset);

    const catalogObjOffset = cleanByteLen + extraObjsStr.length;
    const catalogObjStr = `${catalogObjId} 0 obj\n<< /Type /Catalog /Pages ${pagesObjId} 0 R >>\nendobj\n`;
    extraObjsStr += catalogObjStr;
    objOffsets.set(catalogObjId, catalogObjOffset);

    const totalSize = catalogObjId + 1;
    const xrefOffset = cleanByteLen + extraObjsStr.length;
    let xrefStr = `xref\n0 ${totalSize}\n0000000000 65535 f \n`;
    for (let id = 1; id < totalSize; id++) {
      const off = objOffsets.get(id);
      if (off !== undefined) {
        xrefStr += `${String(off).padStart(10, "0")} 00000 n \n`;
      } else {
        xrefStr += `0000000000 65535 f \n`;
      }
    }
    const trailerStr = `trailer\n<< /Size ${totalSize} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n%DAR_REPAIRED_EOF%\n`;
    const suffixBytes = encoder.encode(extraObjsStr + xrefStr + trailerStr);

    const out = new Uint8Array(cleanByteLen + suffixBytes.length);
    out.set(prefixBytes, 0);
    out.set(suffixBytes, cleanByteLen);
    return isArrayBuffer ? out.buffer : out;
  } catch {
    return isArrayBuffer ? uint8.buffer : uint8;
  }
}

export async function deleteFirestorePdfChunks(pdfUrl) {
  if (!pdfUrl || !String(pdfUrl).startsWith(FIRESTORE_PDF_PREFIX)) return;
  if (!canAttemptFirestoreWrite()) return;
  try {
    const fileId = sanitizeId(String(pdfUrl).slice(FIRESTORE_PDF_PREFIX.length), "pdf");
    const q = query(collection(db, "book_files"), where("file_id", "==", fileId));
    const snap = await getDocs(q);
    await Promise.allSettled(snap.docs.map((d) => deleteDoc(doc(db, "book_files", d.id))));
  } catch (err) {
    if (isQuotaExceededError(err)) markWriteQuotaExhausted();
  }
}

async function handleLocalOrCloudUpload({ file, onProgress }) {
  if (!file) throw new Error("لم يتم اختيار ملف");

  // PDF files: chunk and upload to Firestore (book_files) so ALL users can read the book anywhere,
  // and also cache locally in IndexedDB for instant offline playback on this device.
  if (file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      throw new Error("ملف PDF فارغ");
    }
    const totalChunks = Math.ceil(bytes.length / PDF_CHUNK_RAW_BYTES);
    if (totalChunks > 1000) {
      throw new Error("حجم ملف PDF كبير جداً (الحد الأقصى 400 ميجابايت)");
    }

    const fileId = sanitizeId(`pdf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, "pdf");
    const safeFileName = truncStr(file.name || "book.pdf", 300);
    const pdfUrl = `${FIRESTORE_PDF_PREFIX}${fileId}`;

    onProgress?.({ percent: 45, loaded: Math.round(bytes.length * 0.45), total: bytes.length, speedText: "تجهيز..." });

    // 1. Store immediately in local IndexedDB so the book is 100% ready to save & read right away
    await offlineDB.cachePdf(pdfUrl, buffer, pdfUrl, safeFileName).catch(() => {});

    onProgress?.({ percent: 100, loaded: bytes.length, total: bytes.length, speedText: "جاهز ✓" });

    // 2. Sync chunks to Firestore in the background without blocking the user from saving the book
    if (canAttemptFirestoreWrite()) {
      const now = new Date().toISOString();
      const uploadChunksInBackground = async () => {
        const uploadSingleChunk = async (idx) => {
          const start = idx * PDF_CHUNK_RAW_BYTES;
          const end = Math.min(bytes.length, start + PDF_CHUNK_RAW_BYTES);
          const chunkBytes = bytes.subarray(start, end);
          const chunkData = uint8ToBase64(chunkBytes);
          const chunkId = sanitizeId(`${fileId}_p${idx}`, "chk");
          const docPayload = {
            id: chunkId,
            file_id: fileId,
            chunk_index: idx,
            total_chunks: totalChunks,
            file_name: safeFileName,
            mime_type: "application/pdf",
            size_bytes: bytes.length,
            chunk_data: chunkData,
            created_date: now,
          };
          await setDoc(doc(db, "book_files", chunkId), docPayload);
        };

        try {
          const CONCURRENCY = 3;
          for (let i = 0; i < totalChunks; i += CONCURRENCY) {
            if (!canAttemptFirestoreWrite()) break;
            const batch = [];
            for (let j = i; j < Math.min(totalChunks, i + CONCURRENCY); j++) {
              batch.push(uploadSingleChunk(j));
            }
            await Promise.all(batch);
          }
        } catch (err) {
          if (isQuotaExceededError(err)) {
            markWriteQuotaExhausted();
          }
          // Keep already-uploaded chunks intact so partial uploads can be resumed or reconstructed
        }
      };

      uploadChunksInBackground().catch(() => {});
    }

    return { file_url: pdfUrl, url: pdfUrl };
  }

  // Image files: compress to Data URL so it fits cleanly within Firestore's 500KB field limit
  if (file.type?.startsWith("image/")) {
    let dataUrl = await compressImageToDataUrl(file, 1200, 0.82);
    if (dataUrl.length > 460000) {
      dataUrl = await compressImageToDataUrl(file, 720, 0.65);
    }
    if (dataUrl.length > 480000) {
      throw new Error("حجم الصورة كبير جداً بعد الضغط — يرجى اختيار صورة أصغر");
    }
    return { file_url: dataUrl, url: dataUrl };
  }

  // Other files (custom fonts, etc.): convert to Data URL and enforce Firestore 500KB field limit
  const dataUrl = await compressImageToDataUrl(file);
  if (dataUrl.length > 460000) {
    throw new Error("حجم الملف كبير جداً للتخزين السحابي (الحد الأقصى ~320 كيلوبايت)، استخدم ملفاً أصغر أو رابطاً مباشراً");
  }
  return { file_url: dataUrl, url: dataUrl };
}

// ─── YouTube Metadata Resolver (Replaces Base44 fetchVideoMeta function) ──────
async function fetchVideoMetaFromUrl(url) {
  if (!url) return {};
  const ytMatch = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  const videoId = ytMatch ? ytMatch[1] : "";
  const defaultThumb = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const json = await res.json();
      return {
        data: {
          title: json.title || "",
          channel_name: json.author_name || "",
          thumbnail: defaultThumb || json.thumbnail_url || "",
          duration: "",
        },
      };
    }
  } catch {}

  return {
    data: {
      title: "",
      channel_name: "",
      thumbnail: defaultThumb,
      duration: "",
    },
  };
}

// ─── Instantiate Entities Map ─────────────────────────────────────────────────
const BookEntity = createPublicCatalogEntity({
  collectionName: "books",
  sanitizeFn: sanitizeBook,
  getCachedAll: offlineDB.getCachedBooks,
  cacheAll: offlineDB.cacheBooks,
  replaceCachedAll: offlineDB.replaceCachedBooks,
  deleteCached: offlineDB.deleteCachedBook,
  seedList: seedBooks || [],
});

const VideoEntity = createPublicCatalogEntity({
  collectionName: "videos",
  sanitizeFn: sanitizeVideo,
  getCachedAll: offlineDB.getCachedVideos,
  cacheAll: offlineDB.cacheVideos,
  replaceCachedAll: offlineDB.replaceCachedVideos,
  deleteCached: offlineDB.deleteCachedVideo,
  seedList: seedVideos || [],
});

const VideoChannelEntity = createPublicCatalogEntity({
  collectionName: "video_channels",
  sanitizeFn: sanitizeVideoChannel,
  getCachedAll: offlineDB.getCachedVideoChannels,
  cacheAll: offlineDB.cacheVideoChannels,
  replaceCachedAll: offlineDB.replaceCachedVideoChannels,
  deleteCached: offlineDB.deleteCachedVideoChannel,
  seedList: seedVideoChannels || [],
});

const SocialChannelEntity = createPublicCatalogEntity({
  collectionName: "social_channels",
  sanitizeFn: sanitizeSocialChannel,
  getCachedAll: offlineDB.getCachedSocialChannels,
  cacheAll: offlineDB.cacheSocialChannels,
  replaceCachedAll: offlineDB.replaceCachedSocialChannels,
  deleteCached: offlineDB.deleteCachedSocialChannel,
  seedList: seedSocialChannels || [],
});

const AppSettingsEntity = createPublicCatalogEntity({
  collectionName: "app_settings",
  sanitizeFn: sanitizeAppSetting,
  getCachedAll: offlineDB.getCachedSettings,
  cacheAll: offlineDB.cacheSettings,
  replaceCachedAll: offlineDB.replaceCachedSettings,
  deleteCached: offlineDB.deleteCachedSetting,
  seedList: dedupedSeedSettings,
});

const entitiesMap = {
  Book: BookEntity,
  Video: VideoEntity,
  VideoChannel: VideoChannelEntity,
  SocialChannel: SocialChannelEntity,
  AppSettings: AppSettingsEntity,
  Favorite: FavoriteEntity,
  AccountData: AccountDataEntity,
  User: UserEntity,
  Author: createLocalBackedEntity("Author", []),
  Category: createLocalBackedEntity("Category", []),
  TranslationLanguage: createLocalBackedEntity("TranslationLanguage", seedTranslationLanguages || []),
  Translation: createLocalBackedEntity("Translation", seedTranslations || []),
  BookTranslation: createLocalBackedEntity("BookTranslation", []),
  TranslationGlossary: createLocalBackedEntity("TranslationGlossary", []),
  ContactMessage: createLocalBackedEntity("ContactMessage", []),
};

const entitiesProxy = new Proxy(entitiesMap, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === "string") {
      target[prop] = createLocalBackedEntity(prop, []);
      return target[prop];
    }
    return undefined;
  },
});

// ─── Unified Client Exporting the Exact `base44` Interface ───────────────────
export const base44 = {
  entities: entitiesProxy,

  startRealtimeCatalogSync() {
    const unsubs = [
      BookEntity.subscribeRealtime?.(),
      VideoEntity.subscribeRealtime?.(),
      VideoChannelEntity.subscribeRealtime?.(),
      SocialChannelEntity.subscribeRealtime?.(),
      AppSettingsEntity.subscribeRealtime?.(),
    ].filter((fn) => typeof fn === "function");
    return () => {
      unsubs.forEach((fn) => {
        try { fn(); } catch {}
      });
    };
  },

  auth: {
    async me() {
      return readCurrentUserProfile();
    },

    async updateMe(patch = {}) {
      const current = readCurrentUserProfile();
      const updated = {
        ...current,
        ...patch,
        updated_date: new Date().toISOString(),
      };
      writeCurrentUserProfile(updated);
      await UserEntity.update(updated.id, updated).catch(() => {});

      if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
        const docId = sanitizeId(auth.currentUser.uid, "usr");
        let serverUser = null;
        try {
          const snap = await getDoc(doc(db, "users", docId));
          if (snap.exists()) serverUser = snap.data();
        } catch {}
        const isOwnerEmail = isOwnerAddress(
          serverUser?.email || updated.email || auth.currentUser.email || ""
        );
        const sanitizedUser = {
          id: docId,
          uid: serverUser?.uid || docId,
          email: truncStr(serverUser?.email || updated.email || auth.currentUser.email || OWNER_EMAIL, 256),
          full_name: truncStr(updated.full_name || "", 200),
          role: serverUser
            ? isOwnerEmail && updated.role === "admin"
              ? "admin"
              : serverUser.role || "user"
            : updated.role === "admin"
            ? "admin"
            : "user",
          notifications_enabled: Boolean(updated.notifications_enabled ?? true),
          preferred_language: truncStr(updated.preferred_language || "العربية", 64),
          avatar_url: truncStr(updated.avatar_url || "", 500000),
          created_date: truncStr(serverUser?.created_date || updated.created_date || new Date().toISOString(), 64),
          updated_date: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "users", docId), sanitizedUser);
        } catch (error) {
          if (!isNetworkLikeError(error)) {
            handleFirestoreError(error, OperationType.UPDATE, `users/${docId}`);
          }
        }
      }
      return updated;
    },

    async isAuthenticated() {
      return !!readCurrentUserProfile();
    },

    async logout(redirectUrl) {
      try {
        localStorage.setItem("dau_logged_out", "true");
        localStorage.removeItem(USER_PROFILE_KEY);
        localStorage.removeItem("dau_account_email");
        localStorage.removeItem("dau_full_name");
        localStorage.removeItem("base44_access_token");
        localStorage.removeItem("token");
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("email_verified_")) localStorage.removeItem(k);
        });
        await auth.signOut();
      } catch {}
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("dau-email-change"));
        window.dispatchEvent(new Event("dau-email-verified"));
        window.dispatchEvent(new Event("dau-avatar-change"));
      }
      if (redirectUrl && typeof window !== "undefined") {
        window.location.href = redirectUrl;
      }
    },

    async signInWithVerifiedEmail(email, fullName) {
      const normalized = truncStr(String(email || "").trim().toLowerCase(), 256);
      if (!normalized) return null;
      try {
        localStorage.removeItem("dau_logged_out");
        localStorage.setItem("dau_account_email", normalized);
        localStorage.setItem(`email_verified_${normalized}`, "1");
      } catch {}
      const current = readCurrentUserProfile() || {};
      const now = new Date().toISOString();
      const profileId = sanitizeId(`otp_${normalized}`, "usr");
      const profile = {
        ...current,
        id: current.id || profileId,
        uid: current.uid || profileId,
        email: normalized,
        full_name: truncStr(fullName || current.full_name || normalized.split("@")[0] || "مستخدم DAR AL TAWHID", 200),
        role: isOwnerAddress(normalized) ? "admin" : current.role || "user",
        notifications_enabled: current.notifications_enabled ?? true,
        preferred_language: truncStr(current.preferred_language || "العربية", 64),
        verified: true,
        created_date: truncStr(current.created_date || now, 64),
        updated_date: now,
      };
      writeCurrentUserProfile(profile);
      await UserEntity.update(profile.id, profile).catch(() => {});
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("dau-email-change"));
        window.dispatchEvent(new Event("dau-email-verified"));
      }
      return profile;
    },

    async signInWithGoogle() {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const err = new Error("لا يوجد اتصال بالإنترنت حالياً. يرجى التحقق من الشبكة والمحاولة مرة أخرى.");
        err.code = "NETWORK_ERROR";
        throw err;
      }
      localStorage.removeItem("dau_logged_out");
      const basicGoogleProvider = new GoogleAuthProvider();
      basicGoogleProvider.addScope("https://www.googleapis.com/auth/userinfo.email");
      basicGoogleProvider.addScope("https://www.googleapis.com/auth/userinfo.profile");
      basicGoogleProvider.setCustomParameters({ prompt: "select_account" });
      let result;
      try {
        result = await signInWithPopup(auth, basicGoogleProvider);
      } catch (error) {
        const code = error?.code || "";
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          const err = new Error("تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.");
          err.code = "POPUP_CLOSED";
          throw err;
        }
        if (code === "auth/network-request-failed") {
          const err = new Error("تعذر الاتصال بخادم مصادقة Google. يرجى التحقق من الشبكة أو استخدام تسجيل الدخول برمز التحقق (OTP).");
          err.code = "NETWORK_ERROR";
          throw err;
        }
        if (
          code === "auth/unauthorized-domain" ||
          code === "auth/operation-not-supported-in-this-environment" ||
          code === "auth/popup-blocked"
        ) {
          const err = new Error("تعذر فتح نافذة تسجيل الدخول عبر Google في هذا المتصفح. يمكنك استخدام تسجيل الدخول برمز التحقق (OTP).");
          err.code = "WEBVIEW_GOOGLE_BLOCKED";
          throw err;
        }
        const err = new Error("تعذر إتمام تسجيل الدخول عبر Google حالياً.");
        err.code = code || "AUTH_ERROR";
        throw err;
      }
      const fbUser = result?.user;
      if (!fbUser?.email) {
        throw new Error("NO_EMAIL");
      }
      if (fbUser.displayName) {
        try {
          localStorage.setItem("dau_full_name", fbUser.displayName);
        } catch {}
      }
      if (fbUser.photoURL) {
        try {
          const norm = fbUser.email.trim().toLowerCase();
          if (!localStorage.getItem(`dau_avatar_${norm}`)) {
            localStorage.setItem(`dau_avatar_${norm}`, fbUser.photoURL);
            window.dispatchEvent(new Event("dau-avatar-change"));
          }
        } catch {}
      }
      return await this.signInWithVerifiedEmail(fbUser.email, fbUser.displayName);
    },

    async redirectToLogin() {
      try {
        return await this.signInWithGoogle();
      } catch (err) {
        if (typeof window !== "undefined") {
          window.location.href = "/verify-email";
        }
        return null;
      }
    },
  },

  users: {
    async inviteUser(email, role = "user") {
      if (!email) throw new Error("يرجى إدخال البريد الإلكتروني");
      const now = new Date().toISOString();
      const id = sanitizeId(`inv_${email}`, "usr");
      return UserEntity.create({
        id,
        uid: id,
        email: truncStr(email, 256),
        full_name: email.split("@")[0],
        role: role === "admin" ? "admin" : "user",
        notifications_enabled: true,
        preferred_language: "العربية",
        created_date: now,
        updated_date: now,
      });
    },
  },

  integrations: {
    Core: {
      UploadFile: handleLocalOrCloudUpload,
      UploadPublicFile: handleLocalOrCloudUpload,

      async SendEmail({ to, subject, body, html, cc = undefined, bcc = undefined, token = null }) {
        return sendGmailMessage({ to, subject, body, html, cc, bcc, token });
      },

      async InvokeLLM({ prompt, response_json_schema = undefined }) {
        const books = await BookEntity.list("-created_date", 200).catch(() => []);
        const rawPrompt = String(prompt || "");
        const quotedMatch = rawPrompt.match(/["«]([^"»]+)["»]/);
        const q = (quotedMatch ? quotedMatch[1] : rawPrompt).trim().toLowerCase();
        const matched = books.filter(
          (b) =>
            String(b.title || "").toLowerCase().includes(q) ||
            String(b.author || "").toLowerCase().includes(q) ||
            String(b.category || "").toLowerCase().includes(q) ||
            String(b.description || "").toLowerCase().includes(q)
        );
        if (response_json_schema) {
          return {
            matching_ids: matched.map((b) => b.id),
            explanation: matched.length > 0 ? `تم العثور على ${matched.length} كتاب مطابق` : "لم يتم العثور على كتب مطابقة",
          };
        }
        const listToFormat = matched.length > 0 ? matched.slice(0, 5) : books.slice(0, 5);
        if (listToFormat.length === 0) {
          return "لم يتم العثور على كتب مطابقة في المكتبة حالياً.";
        }
        return listToFormat
          .map(
            (b, i) =>
              `${i + 1}. **${b.title}** — المؤلف: ${b.author || "غير محدد"} (${b.category || "عام"})${
                b.description ? `\n   ${b.description}` : ""
              }`
          )
          .join("\n\n");
      },
    },
  },

  functions: {
    async invoke(fnName, payload = {}) {
      if (fnName === "fetchVideoMeta") {
        return fetchVideoMetaFromUrl(payload?.url);
      }

      if (fnName === "sendContactMessage") {
        const now = new Date().toISOString();
        const id = sanitizeId(`msg_${Date.now()}`, "msg");
        const msg = {
          id,
          name: truncStr(payload?.name || "زائر", 200),
          email: truncStr(payload?.email || "visitor@example.com", 256),
          message: truncStr(payload?.message || "", 5000),
          ownerUid: auth.currentUser?.uid || "anonymous",
          created_date: now,
        };
        await entitiesMap.ContactMessage.create(msg);
        if (canAttemptFirestoreWrite() && isVerifiedUser() && auth.currentUser) {
          try {
            await setDoc(doc(db, "contact_messages", id), msg);
          } catch (error) {
            if (!isNetworkLikeError(error)) {
              handleFirestoreError(error, OperationType.CREATE, `contact_messages/${id}`);
            }
          }
        }
        return { data: { ok: true, id } };
      }

      if (fnName === "deleteAccountRequest") {
        const user = readCurrentUserProfile();
        if (user?.email) {
          const accs = await AccountDataEntity.filter({ account_email: user.email });
          for (const a of accs) {
            await AccountDataEntity.delete(a.id);
          }
        }
        return { data: { ok: true } };
      }

      return { data: { ok: true } };
    },
  },
};
