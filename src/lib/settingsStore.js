/**
 * settingsStore — permanent settings management
 * 
 * Flow:
 *  1. On app start → load from DB → apply + cache in localStorage
 *  2. On change    → apply instantly + save to DB with debounce
 *  3. On DB save   → dispatch "app-settings-changed" event so all components re-render
 *  4. If DB fails  → localStorage backup keeps it working + retry
 */
import { entities } from "@/lib/dataSource";
import { toast } from "sonner";

// ─── Default settings ─────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  app_name:          "المكتبة الدينية",
  app_subtitle:      "نور العلم والمعرفة",
  logo_url:          "https://media.base44.com/images/public/69c8e483a69a0d215eee4ef7/6482533e8_IMG_2785.png",
  // Colors (HSL strings)
  color_bg:          "",
  color_fg:          "",
  color_primary:     "",
  color_secondary:   "",
  color_accent:      "",
  color_card:        "",
  color_border:       "",
  color_button:       "",
  // Dark mode colors (HSL strings)
  color_dark_bg:      "",
  color_dark_fg:      "",
  color_dark_primary: "",
  color_dark_secondary: "",
  color_dark_accent:  "",
  color_dark_card:    "",
  color_dark_border:  "",
  color_dark_button:  "",
  // Fonts per role
  font_body:         "",
  font_heading:      "",
  font_title:        "",
  font_nav:          "",
  font_button:       "",
  // Hero background
  hero_bg_type:      "gradient_anim",
  hero_bg_url:       "",
  hero_bg_opacity:   "100",
  hero_bg_blur:      "0",
  hero_bg_brightness:"100",
  hero_bg_contrast:  "100",
  hero_bg_saturation:"100",
  hero_overlay_color:"#000000",
  hero_overlay_alpha:"30",
  hero_anim_speed:   "5",
  hero_zoom:         "false",
  hero_parallax:     "false",
  hero_title:        "",
  hero_subtitle:     "",
  hero_btn_text:     "",
  hero_btn_link:     "/books",
  hero_grad_from:    "#134e2a",
  hero_grad_to:      "#1a6b3c",
  hero_slideshow_urls:"[]",
  hero_slide_transition:"fade",
  hero_slide_duration:"4",
  hero_video_autoplay:"true",
  hero_video_loop:   "true",
  hero_video_mute:   "true",
  hero_video_brightness:"100",
  hero_video_mobile: "true",
  hero_video_speed:  "1",
  hero_lottie_url:   "",
  hero_custom_html:  "",
  hero_bg_preset:    "",
  // Fonts
  font_size:         "16",
  line_height:       "1.6",
  letter_spacing:    "0",
  custom_fonts:      "[]",
  // Cards
  card_radius:       "16",
  card_padding:      "16",
  card_gap:          "16",
  card_style:        "modern",
  card_shadow:       "md",
  card_hover:        "lift",
  // UI
  ui_radius:         "12",
  // Nav
  nav_items:         "",
  // Misc
  youtube_url:       "",
  youtube_label:     "قناتنا على يوتيوب",
  youtube_sub:       "تابعونا على قناتنا لمزيد من المحتوى الإسلامي",
  app_lang:          "ar",
  dark_mode:         "false",
  theme_mode:        "light",  // light | dark | auto
  show_dev_nav:      "true",
  categories:        "",
  offline_mode:      "true",
  // Contact page
  contact_email:       "",
  contact_phone:       "",
  contact_address:     "",
  contact_intro:       "",
  contact_show_form:   "true",
  whatsapp_url:        "",
  contact_telegram_url:"",
  contact_instagram_url:"",
  // Background layers & presets
  custom_bg_presets:   "[]",
  hero_extra_layers:   "[]",
  hero_custom_layers:  "[]",
  // Translation settings
  translation_model:          "",
  translation_preserve_terms: "",
  // Video section visibility
  videos_enabled:      "true",
  videos_show_info:    "true",
};

// End-user local preference keys that should not overwrite global admin settings on other devices,
// while still persisting per-user display preferences on this device.
const USER_LOCAL_PREF_KEYS = new Set(["theme_mode", "dark_mode", "app_lang"]);

// ─── localStorage helpers ─────────────────────────────────────────────────────
const LS_PREFIX = "devs_";
const ls = {
  get: (k)    => { try { return localStorage.getItem(LS_PREFIX + k); } catch(e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(LS_PREFIX + k, v); }    catch(e) {} },
  getAll: ()  => {
    const result = {};
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
      const v = ls.get(k);
      if (v !== null) result[k] = v;
    });
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const rawKey = localStorage.key(i);
        if (rawKey && rawKey.startsWith(LS_PREFIX)) {
          const k = rawKey.slice(LS_PREFIX.length);
          if (k && k !== "_migrated" && !(k in result)) {
            const v = localStorage.getItem(rawKey);
            if (v !== null) result[k] = v;
          }
        }
      }
    } catch {}
    return result;
  },
  setAll: (obj) => { Object.entries(obj).forEach(([k,v]) => ls.set(k, v)); },
};

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function dbGetAll() {
  try {
    const rows = await entities.AppSettings.list('-updated_date', 200);
    const map = {};
    rows.forEach(r => { if (r.setting_key) map[r.setting_key] = r.setting_value || ""; });
    return map;
  } catch(e) { return null; }
}

async function dbSet(key, value, previousValue, userEmail) {
  try {
    await entities.AppSettings.update(key, {
      setting_key: key,
      setting_value: String(value ?? ""),
      setting_type: "text",
      previous_value: previousValue ? String(previousValue) : "",
      changed_by: userEmail || "admin",
    });
    return true;
  } catch (e) {
    console.error("Failed saving setting:", key, e?.message);
    return false;
  }
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
let _cache = { ...DEFAULT_SETTINGS };
let _userEmail = "";

// ─── Apply settings to DOM ────────────────────────────────────────────────────
import { FONT_PRESETS, FONT_ROLES } from "@/lib/fontConstants";

function applyColorVar(cssVar, hslValue) {
  if (hslValue) document.documentElement.style.setProperty(cssVar, hslValue);
  else document.documentElement.style.removeProperty(cssVar);
}

function syncCustomFontFaces(customFonts) {
  customFonts.forEach((f) => {
    if (!f?.name || !f?.file_url) return;
    const styleId = `dff-${String(f.name).replace(/\s+/g, "-")}`;
    let style = document.getElementById(styleId);
    const rule = `@font-face { font-family: '${f.name}'; src: url('${f.file_url}'); font-display: swap; }`;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      style.textContent = rule;
      document.head.appendChild(style);
    } else if (style.textContent !== rule) {
      style.textContent = rule;
    }
  });
}

export function applySettingsToDom(settings) {
  // Dark mode — resolve first so custom colors can be skipped in dark mode
  const themeMode = settings.theme_mode || (settings.dark_mode === "true" ? "dark" : "light");
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const resolvedDark = themeMode === "dark" ? true : themeMode === "light" ? false : systemDark;
  document.documentElement.classList.toggle("dark", resolvedDark);

  // Colors — only apply custom overrides in light mode; in dark mode apply dark overrides
  if (!resolvedDark) {
    applyColorVar("--background",      settings.color_bg);
    applyColorVar("--foreground",      settings.color_fg);
    applyColorVar("--card",            settings.color_card);
    applyColorVar("--popover",         settings.color_card);
    applyColorVar("--accent",          settings.color_accent);
    applyColorVar("--secondary",       settings.color_secondary);
    applyColorVar("--border",          settings.color_border);
    applyColorVar("--input",           settings.color_border);
    applyColorVar("--primary",         settings.color_primary);
    applyColorVar("--ring",            settings.color_primary);
    applyColorVar("--sidebar-primary", settings.color_primary);
  } else {
    // Dark mode — apply the dark custom overrides (removed automatically when empty)
    applyColorVar("--background",      settings.color_dark_bg);
    applyColorVar("--foreground",      settings.color_dark_fg);
    applyColorVar("--card",            settings.color_dark_card);
    applyColorVar("--popover",         settings.color_dark_card);
    applyColorVar("--accent",          settings.color_dark_accent);
    applyColorVar("--secondary",       settings.color_dark_secondary);
    applyColorVar("--border",          settings.color_dark_border);
    applyColorVar("--input",           settings.color_dark_border);
    applyColorVar("--primary",         settings.color_dark_primary);
    applyColorVar("--ring",            settings.color_dark_primary);
    applyColorVar("--sidebar-primary", settings.color_dark_primary);
  }

  // Custom uploaded fonts
  let customFonts = [];
  try {
    const parsed = JSON.parse(settings.custom_fonts || "[]");
    if (Array.isArray(parsed)) customFonts = parsed;
  } catch {}
  syncCustomFontFaces(customFonts);
  const allFonts = [...FONT_PRESETS, ...customFonts];

  // Fonts per role
  FONT_ROLES.forEach(role => {
    const fontKey = `font_${role.key}`;
    const fontName = settings[fontKey];
    if (fontName) {
      const preset = allFonts.find(f => f.name === fontName);
      if (preset) {
        if (preset.url) {
          const linkId = `sf-font-${preset.name.replace(/\s+/g,"-")}`;
          if (!document.getElementById(linkId)) {
            const link = document.createElement("link");
            link.id = linkId; link.rel = "stylesheet"; link.href = preset.url;
            document.head.appendChild(link);
          }
        }
        document.documentElement.style.setProperty(role.cssVar, preset.value);
      }
    } else {
      document.documentElement.style.removeProperty(role.cssVar);
    }
  });

  // Typography
  const size = settings.font_size;
  if (size && size !== "16") document.documentElement.style.setProperty("font-size", `${size}px`);
  else document.documentElement.style.removeProperty("font-size");

  const lineHeight = settings.line_height;
  if (lineHeight && lineHeight !== "1.6") document.documentElement.style.setProperty("line-height", String(lineHeight));
  else document.documentElement.style.removeProperty("line-height");

  const letterSpacing = settings.letter_spacing;
  if (letterSpacing && letterSpacing !== "0") document.documentElement.style.setProperty("letter-spacing", `${letterSpacing}em`);
  else document.documentElement.style.removeProperty("letter-spacing");

  // Layout & Card dimensions
  if (settings.ui_radius) document.documentElement.style.setProperty("--radius", `${settings.ui_radius}px`);
  else document.documentElement.style.removeProperty("--radius");

  if (settings.card_radius) document.documentElement.style.setProperty("--card-radius", `${settings.card_radius}px`);
  else document.documentElement.style.removeProperty("--card-radius");

  if (settings.card_padding) document.documentElement.style.setProperty("--card-padding", `${settings.card_padding}px`);
  else document.documentElement.style.removeProperty("--card-padding");

  if (settings.card_gap) document.documentElement.style.setProperty("--card-gap", `${settings.card_gap}px`);
  else document.documentElement.style.removeProperty("--card-gap");

  // Sync legacy i18n keys used by useT()
  try {
    if (settings.app_name !== undefined) {
      if (settings.app_name && settings.app_name !== DEFAULT_SETTINGS.app_name) {
        localStorage.setItem("dev_app_name", settings.app_name);
      } else {
        localStorage.removeItem("dev_app_name");
      }
    }
    if (settings.app_subtitle !== undefined) {
      if (settings.app_subtitle && settings.app_subtitle !== DEFAULT_SETTINGS.app_subtitle) {
        localStorage.setItem("dev_app_subtitle", settings.app_subtitle);
      } else {
        localStorage.removeItem("dev_app_subtitle");
      }
    }
    if (settings.app_lang) {
      const prevLang = localStorage.getItem("dev_app_lang");
      if (prevLang !== settings.app_lang) {
        localStorage.setItem("dev_app_lang", settings.app_lang);
        window.dispatchEvent(new Event("app-lang-change"));
      }
    }
  } catch {}
}

// ─── Dispatch change event ────────────────────────────────────────────────────
function dispatchChange() {
  window.dispatchEvent(new CustomEvent("app-settings-changed", { detail: { ..._cache } }));
  // Also fire storage event for Layout compatibility
  window.dispatchEvent(new Event("storage"));
}

// ─── Debounce save queue ──────────────────────────────────────────────────────
const _saveTimers = {};
const _pendingSaves = {};
const _inFlightSaves = new Map();
let _saveStatus = "idle"; // idle | saving | saved | error
const _statusListeners = [];
let _lastErrorToastAt = 0;

function emitStatus(s) {
  _saveStatus = s;
  _statusListeners.forEach(fn => fn(s));
}

export function onSaveStatus(fn) {
  _statusListeners.push(fn);
  return () => { const i = _statusListeners.indexOf(fn); if (i>=0) _statusListeners.splice(i,1); };
}

export function getSaveStatus() { return _saveStatus; }

const _prevValues = {};

function flushSave(key) {
  if (_pendingSaves[key] === undefined) {
    return _inFlightSaves.get(key) || Promise.resolve(true);
  }
  const value = _pendingSaves[key];
  delete _pendingSaves[key];
  clearTimeout(_saveTimers[key]);
  const previous = _prevValues[key] ?? ls.get(key) ?? "";
  ls.set(key, value);
  emitStatus("saving");

  const run = (async () => {
    let ok = await dbSet(key, value, previous, _userEmail);
    if (!ok) {
      await new Promise(r => setTimeout(r, 600));
      ok = await dbSet(key, value, previous, _userEmail);
    }
    if (!ok) {
      emitStatus("error");
      const now = Date.now();
      if (now - _lastErrorToastAt > 6000) {
        _lastErrorToastAt = now;
        try { toast.error("تعذر حفظ التعديلات سحابياً — تحقق من الاتصال"); } catch {}
      }
    } else if (Object.keys(_pendingSaves).length === 0) {
      emitStatus("saved");
      setTimeout(() => { if (_saveStatus === "saved") emitStatus("idle"); }, 2000);
    }
    return ok;
  })().finally(() => {
    if (_inFlightSaves.get(key) === run) {
      _inFlightSaves.delete(key);
    }
  });

  _inFlightSaves.set(key, run);
  return run;
}

/** Immediately flush every pending debounced setting and await all active cloud saves */
export async function flushAllPendingSettings() {
  const pendingKeys = Object.keys(_pendingSaves);
  pendingKeys.forEach((k) => clearTimeout(_saveTimers[k]));
  const promises = [
    ...pendingKeys.map((k) => flushSave(k)),
    ...Array.from(_inFlightSaves.values()),
  ];
  if (promises.length === 0) return { ok: true };
  const results = await Promise.all(promises);
  return { ok: results.every((r) => r !== false) };
}

if (typeof window !== "undefined") {
  const flushOnLeave = () => {
    if (Object.keys(_pendingSaves).length > 0) {
      flushAllPendingSettings().catch(() => {});
    }
  };
  window.addEventListener("pagehide", flushOnLeave);
  window.addEventListener("beforeunload", flushOnLeave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnLeave();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Get a setting value */
export function getSetting(key) {
  return _cache[key] ?? DEFAULT_SETTINGS[key] ?? "";
}

/** Update a setting: applies instantly + persists locally & saves to DB */
export function setSetting(key, value) {
  const strVal = String(value ?? "");
  _prevValues[key] = _cache[key] ?? "";
  _cache[key] = strVal;
  ls.set(key, strVal);
  applySettingsToDom(_cache);
  dispatchChange();

  // Debounced DB save
  clearTimeout(_saveTimers[key]);
  _pendingSaves[key] = strVal;
  _saveTimers[key] = setTimeout(() => { flushSave(key); }, 250);
}

/** Update multiple settings at once */
export function setSettings(obj) {
  Object.entries(obj).forEach(([k,v]) => {
    const strVal = String(v ?? "");
    _prevValues[k] = _cache[k] ?? "";
    _cache[k] = strVal;
    ls.set(k, strVal);
  });
  applySettingsToDom(_cache);
  dispatchChange();
  Object.entries(obj).forEach(([k,v]) => {
    clearTimeout(_saveTimers[k]);
    _pendingSaves[k] = String(v ?? "");
    _saveTimers[k] = setTimeout(() => { flushSave(k); }, 250);
  });
}

/** Load settings on app start — DB is authoritative for DevPanel config, localStorage fast-path */
export async function loadSettings(userEmail) {
  _userEmail = userEmail || "";
  // 1. Apply localStorage immediately (fast path before DB resolves)
  const cached = ls.getAll();
  let legacyLang = "";
  try { legacyLang = localStorage.getItem("dev_app_lang") || ""; } catch {}
  if (!cached.app_lang && legacyLang) cached.app_lang = legacyLang;

  _cache = { ...DEFAULT_SETTINGS, ...cached };
  applySettingsToDom(_cache);
  dispatchChange();

  // 2. Load from DB and let authoritative server settings take effect
  const dbData = await dbGetAll();
  if (dbData && Object.keys(dbData).length > 0) {
    const merged = { ...DEFAULT_SETTINGS, ...dbData };
    // Preserve device-local user display preferences if previously set
    USER_LOCAL_PREF_KEYS.forEach((k) => {
      if (cached[k] !== undefined && cached[k] !== null && cached[k] !== "") {
        merged[k] = String(cached[k]);
      }
    });
    // Preserve any in-flight local edits not yet flushed to DB
    Object.entries(_pendingSaves).forEach(([k, v]) => {
      merged[k] = String(v);
    });
    _cache = merged;
    ls.setAll(_cache);
    applySettingsToDom(_cache);
    dispatchChange();
  }
  return _cache;
}

/** Get all current settings */
export function getAllSettings() { return { ..._cache }; }

// ─── Subscribe to settings changes ────────────────────────────────────────────
export function subscribeToSettings(callback) {
  const handler = (e) => callback(e.detail || getAllSettings());
  window.addEventListener("app-settings-changed", handler);
  return () => window.removeEventListener("app-settings-changed", handler);
}

// ─── Legacy localStorage keys migration ───────────────────────────────────────
// Migrate old dev_* keys to new system on first run
export function migrateLegacySettings() {
  const legacyMap = {
    "dev_app_name":      "app_name",
    "dev_app_subtitle":  "app_subtitle",
    "dev_logo_url":      "logo_url",
    "dev_bg":            "color_bg",
    "dev_fg":            "color_fg",
    "dev_primary":       "color_primary",
    "dev_accent":        "color_accent",
    "dev_card":          "color_card",
    "dev_font_body":     "font_body",
    "dev_font_heading":  "font_heading",
    "dev_font_title":    "font_title",
    "dev_font_nav":      "font_nav",
    "dev_font_button":   "font_button",
    "dev_font_size":     "font_size",
    "dev_youtube_url":   "youtube_url",
    "dev_youtube_label": "youtube_label",
    "dev_youtube_sub":   "youtube_sub",
    "dev_app_lang":      "app_lang",
    "dev_dark_mode":     "dark_mode",
    "dev_show_dev_nav":  "show_dev_nav",
    "dev_categories":    "categories",
  };
  let migrated = false;
  Object.entries(legacyMap).forEach(([oldKey, newKey]) => {
    try {
      const v = localStorage.getItem(oldKey);
      if (v !== null && !ls.get(newKey)) {
        ls.set(newKey, v);
        migrated = true;
      }
    } catch(e) {}
  });
  if (migrated) ls.set("_migrated", "1");
}