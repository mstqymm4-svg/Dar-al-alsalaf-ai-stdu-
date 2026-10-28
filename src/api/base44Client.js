import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  getDocFromServer,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import * as offlineDB from "@/lib/offlineDB";
import { googleSignIn, sendGmailMessage } from "@/lib/gmailService";

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
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "app_settings", "connection_test"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

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
const OWNER_EMAIL = "mstqymm4@gmail.com";
const DELETED_IDS_KEY = "dau_deleted_entity_ids_v1";
const LOCAL_ENTITIES_PREFIX = "dau_entity_store_";
const USER_PROFILE_KEY = "dau_current_user_profile";

function sanitizeId(rawId, prefix = "doc") {
  const str = String(rawId || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 128);
  return str || `${prefix}_${Date.now()}`;
}

function truncStr(val, maxLen, fallback = "") {
  if (val === undefined || val === null) return fallback;
  return String(val).slice(0, maxLen);
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
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function unmarkDeletedId(id) {
  if (!id) return;
  try {
    const set = getDeletedIds();
    if (set.delete(String(id))) {
      localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));
    }
  } catch {}
}

function isVerifiedUser() {
  return Boolean(auth.currentUser && auth.currentUser.emailVerified);
}

function canWriteAdminFirestore() {
  return Boolean(auth.currentUser);
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
function sanitizeBook(raw, existing = {}) {
  const now = new Date().toISOString();
  const merged = { ...existing, ...raw };
  const id = sanitizeId(merged.id, "book");
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
        : Number(merged.pages_count) || 0,
    language: truncStr(merged.language || "العربية", 100),
    is_featured: Boolean(merged.is_featured),
    rating: Number(merged.rating) || 0,
    status: truncStr(merged.status || "published", 50),
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
  return {
    id,
    title: truncStr(merged.title || "فيديو", 500),
    description: truncStr(merged.description ?? "", 5000),
    youtube_url: truncStr(merged.youtube_url ?? "", 2000),
    video_url: truncStr(merged.video_url ?? "", 500000),
    video_type: truncStr(merged.video_type || "youtube", 50),
    channel_id: truncStr(merged.channel_id ?? "", 128),
    channel_name: truncStr(merged.channel_name ?? "", 300),
    category: truncStr(merged.category || "عام", 200),
    thumbnail: truncStr(merged.thumbnail ?? "", 500000),
    duration: truncStr(merged.duration ?? "", 50),
    is_featured: Boolean(merged.is_featured),
    visible: merged.visible !== false,
    sort_order: Number(merged.sort_order) || 0,
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
    sort_order: Number(merged.sort_order) || 0,
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
    sort_order: Number(merged.sort_order) || 0,
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

// ─── Firestore Public Collection Adapter (with IndexedDB + Seed Sync) ─────────
function createPublicCatalogEntity({
  collectionName,
  sanitizeFn,
  getCachedAll,
  cacheAll,
  deleteCached,
  seedList,
}) {
  let hasSyncedFromFirestore = false;

  async function loadLocalList() {
    const deleted = getDeletedIds();
    const cached = await getCachedAll().catch(() => []);
    const base = cached && cached.length > 0 ? cached : seedList.map((x) => sanitizeFn(x));
    return base
      .filter((item) => item && !deleted.has(String(item.id)))
      .map((item) => sanitizeFn(item, item));
  }

  async function fetchFromFirestore() {
    const deleted = getDeletedIds();
    try {
      const snap = await getDocs(collection(db, collectionName));
      const docs = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data && !deleted.has(String(data.id || d.id))) {
          docs.push(sanitizeFn({ ...data, id: data.id || d.id }, data));
        }
      });
      if (docs.length > 0) {
        hasSyncedFromFirestore = true;
        await cacheAll(docs).catch(() => {});
        return docs;
      }
      // If Firestore collection is empty and admin is logged in, seed it in background
      const localItems = await loadLocalList();
      if (canWriteAdminFirestore() && localItems.length > 0 && !hasSyncedFromFirestore) {
        hasSyncedFromFirestore = true;
        Promise.allSettled(
          localItems.map((item) =>
            setDoc(doc(db, collectionName, item.id), sanitizeFn(item, item))
          )
        ).catch(() => {});
      }
      return localItems;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
        handleFirestoreError(error, OperationType.LIST, collectionName);
      }
      return loadLocalList();
    }
  }

  return {
    async list(sort = "-created_date", limit = 1000) {
      const items = navigator.onLine ? await fetchFromFirestore() : await loadLocalList();
      return sortRecords(items, sort, limit);
    },

    async filter(queryObj = {}, sort = "-created_date", limit = 1000) {
      const all = await this.list(sort, 1000);
      return sortRecords(filterRecords(all, queryObj), sort, limit);
    },

    async get(id) {
      const cleanId = sanitizeId(id);
      if (getDeletedIds().has(cleanId)) return null;
      if (navigator.onLine) {
        try {
          const snap = await getDoc(doc(db, collectionName, cleanId));
          if (snap.exists()) {
            const item = sanitizeFn({ ...snap.data(), id: cleanId }, snap.data());
            await cacheAll([item]).catch(() => {});
            return item;
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
            handleFirestoreError(error, OperationType.GET, `${collectionName}/${cleanId}`);
          }
        }
      }
      const all = await loadLocalList();
      return all.find((x) => x.id === cleanId || x.setting_key === id) || null;
    },

    async create(payload) {
      const item = sanitizeFn(payload);
      unmarkDeletedId(item.id);
      await cacheAll([item]).catch(() => {});
      if (navigator.onLine && canWriteAdminFirestore()) {
        try {
          await setDoc(doc(db, collectionName, item.id), item);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `${collectionName}/${item.id}`);
        }
      }
      return item;
    },

    async update(id, payload) {
      const existing = (await this.get(id)) || { id: sanitizeId(id) };
      const updated = sanitizeFn(
        { ...existing, ...payload, id: existing.id, updated_date: new Date().toISOString() },
        existing
      );
      await cacheAll([updated]).catch(() => {});
      if (navigator.onLine && canWriteAdminFirestore()) {
        try {
          await setDoc(doc(db, collectionName, updated.id), updated);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${updated.id}`);
        }
      }
      return updated;
    },

    async delete(id) {
      const cleanId = sanitizeId(id);
      markDeletedId(cleanId);
      if (deleteCached) {
        await deleteCached(cleanId).catch(() => {});
      }
      if (navigator.onLine && canWriteAdminFirestore()) {
        try {
          await deleteDoc(doc(db, collectionName, cleanId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${cleanId}`);
        }
      }
      return { id: cleanId, deleted: true };
    },
  };
}

// ─── Favorites Entity (Firestore + IndexedDB) ─────────────────────────────────
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
    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      try {
        const q = query(
          collection(db, "favorites"),
          where("ownerUid", "==", auth.currentUser.uid)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          if (data?.book_id) {
            map.set(data.book_id, {
              id: data.id || d.id,
              book_id: data.book_id,
              user_email: data.user_email || auth.currentUser.email || "",
              ownerUid: data.ownerUid,
              created_date: data.created_date || new Date().toISOString(),
            });
          }
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("Missing or insufficient permissions")) {
          handleFirestoreError(error, OperationType.LIST, "favorites");
        }
      }
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
    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      try {
        await setDoc(doc(db, "favorites", favId), record);
      } catch (error) {
        // Ignore if referenced book hasn't been synced to Firestore yet
        if (error instanceof Error && !error.message.includes("Missing or insufficient permissions")) {
          console.warn("Favorite sync deferred:", error.message);
        }
      }
    }
    return record;
  },

  async update(id, payload) {
    return { id, ...payload };
  },

  async delete(id) {
    const existing = await this.get(id);
    const bookId = existing?.book_id || id;
    await offlineDB.removeLocalFavorite(bookId).catch(() => {});
    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      const favId = sanitizeId(`${auth.currentUser.uid}_${bookId}`, "fav");
      try {
        await deleteDoc(doc(db, "favorites", favId));
      } catch {}
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

    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      try {
        await setDoc(doc(db, "account_data", docId), rec);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `account_data/${docId}`);
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
    const updated = {
      id: docId,
      account_email: truncStr(
        existing.account_email || payload?.account_email || auth.currentUser?.email || OWNER_EMAIL,
        256
      ),
      ownerUid: auth.currentUser?.uid || existing.ownerUid || "local_user",
      data: truncStr(payload?.data ?? existing.data ?? "{}", 800000),
      data_version: Number(payload?.data_version ?? existing.data_version) || 1,
      created_date: truncStr(existing.created_date || now, 64),
      updated_date: now,
    };
    const next = [
      updated,
      ...all.filter((r) => r.id !== id && r.id !== docId && r.account_email !== updated.account_email),
    ];
    saveLocalAccountRecords(next);

    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      try {
        await setDoc(doc(db, "account_data", docId), updated);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `account_data/${docId}`);
      }
    }
    return updated;
  },

  async delete(id) {
    const next = getLocalAccountRecords().filter((r) => r.id !== id);
    saveLocalAccountRecords(next);
    if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
      const docId = sanitizeId(auth.currentUser.uid, "acc");
      try {
        await deleteDoc(doc(db, "account_data", docId));
      } catch {}
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
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const savedName = (() => {
    try {
      return localStorage.getItem("dau_full_name") || "";
    } catch {
      return "";
    }
  })();
  const savedEmail = (() => {
    try {
      return localStorage.getItem("dau_account_email") || OWNER_EMAIL;
    } catch {
      return OWNER_EMAIL;
    }
  })();
  return {
    ...DEFAULT_OWNER_USER,
    email: savedEmail || OWNER_EMAIL,
    full_name: savedName || DEFAULT_OWNER_USER.full_name,
  };
}

function writeCurrentUserProfile(profile) {
  try {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    if (profile?.full_name) localStorage.setItem("dau_full_name", profile.full_name);
    if (profile?.email) localStorage.setItem("dau_account_email", profile.email);
  } catch {}
}

// Keep user profile synced when Firebase Auth state changes
onAuthStateChanged(auth, async (fbUser) => {
  if (!fbUser) return;
  const current = readCurrentUserProfile();
  const isOwner =
    fbUser.email && fbUser.email.toLowerCase() === OWNER_EMAIL.toLowerCase();
  const now = new Date().toISOString();
  const syncedProfile = {
    id: sanitizeId(fbUser.uid, "usr"),
    uid: sanitizeId(fbUser.uid, "usr"),
    email: truncStr(fbUser.email || current.email || OWNER_EMAIL, 256),
    full_name: truncStr(
      fbUser.displayName || current.full_name || "مستخدم دار العلوم",
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
    try {
      await setDoc(doc(db, "users", syncedProfile.id), syncedProfile);
    } catch {}
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

async function handleLocalOrCloudUpload({ file }) {
  if (!file) throw new Error("لم يتم اختيار ملف");

  // PDF files: cache ArrayBuffer in IndexedDB so pdfLoader.js loads it natively
  if (file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const safeName = String(file.name || "book.pdf").replace(/[^a-zA-Z0-9._\-]/g, "_");
    const pdfUrl = `https://local.daraluloom.app/pdfs/${Date.now()}_${safeName}`;
    await offlineDB.cachePdf(pdfUrl, buffer, pdfUrl, file.name || "كتاب").catch(() => {});
    return { file_url: pdfUrl, url: pdfUrl };
  }

  // Image or other files: compress to Data URL so it works immediately and fits in Firestore
  const dataUrl = await compressImageToDataUrl(file);
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
  deleteCached: offlineDB.deleteCachedBook,
  seedList: seedBooks || [],
});

const VideoEntity = createPublicCatalogEntity({
  collectionName: "videos",
  sanitizeFn: sanitizeVideo,
  getCachedAll: offlineDB.getCachedVideos,
  cacheAll: offlineDB.cacheVideos,
  deleteCached: offlineDB.deleteCachedVideo,
  seedList: seedVideos || [],
});

const VideoChannelEntity = createPublicCatalogEntity({
  collectionName: "video_channels",
  sanitizeFn: sanitizeVideoChannel,
  getCachedAll: offlineDB.getCachedVideoChannels,
  cacheAll: offlineDB.cacheVideoChannels,
  deleteCached: offlineDB.deleteCachedVideoChannel,
  seedList: seedVideoChannels || [],
});

const SocialChannelEntity = createPublicCatalogEntity({
  collectionName: "social_channels",
  sanitizeFn: sanitizeSocialChannel,
  getCachedAll: offlineDB.getCachedSocialChannels,
  cacheAll: offlineDB.cacheSocialChannels,
  deleteCached: offlineDB.deleteCachedSocialChannel,
  seedList: seedSocialChannels || [],
});

const AppSettingsEntity = createPublicCatalogEntity({
  collectionName: "app_settings",
  sanitizeFn: sanitizeAppSetting,
  getCachedAll: offlineDB.getCachedSettings,
  cacheAll: offlineDB.cacheSettings,
  deleteCached: null,
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

      if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
        const docId = sanitizeId(auth.currentUser.uid, "usr");
        const sanitizedUser = {
          id: docId,
          uid: docId,
          email: truncStr(updated.email || auth.currentUser.email || OWNER_EMAIL, 256),
          full_name: truncStr(updated.full_name || "", 200),
          role: updated.role === "admin" ? "admin" : "user",
          notifications_enabled: Boolean(updated.notifications_enabled ?? true),
          preferred_language: truncStr(updated.preferred_language || "العربية", 64),
          avatar_url: truncStr(updated.avatar_url || "", 500000),
          created_date: truncStr(updated.created_date || new Date().toISOString(), 64),
          updated_date: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "users", docId), sanitizedUser);
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `users/${docId}`);
        }
      }
      return updated;
    },

    async isAuthenticated() {
      return true;
    },

    async logout(redirectUrl) {
      try {
        await auth.signOut();
      } catch {}
      if (redirectUrl && typeof window !== "undefined") {
        window.location.href = redirectUrl;
      }
    },

    async redirectToLogin() {
      try {
        await googleSignIn();
      } catch {}
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

      async SendEmail({ to, subject, body, html }) {
        return sendGmailMessage({ to, subject, body, html });
      },

      async InvokeLLM({ prompt }) {
        const books = await BookEntity.list("-created_date", 200).catch(() => []);
        const q = String(prompt || "").trim().toLowerCase();
        const matched = books.filter(
          (b) =>
            String(b.title || "").toLowerCase().includes(q) ||
            String(b.author || "").toLowerCase().includes(q) ||
            String(b.category || "").toLowerCase().includes(q) ||
            String(b.description || "").toLowerCase().includes(q)
        );
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
        if (navigator.onLine && isVerifiedUser() && auth.currentUser) {
          try {
            await setDoc(doc(db, "contact_messages", id), msg);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, `contact_messages/${id}`);
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
