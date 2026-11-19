import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import {
  Bell,
  Moon,
  Sun,
  Globe,
  LogOut,
  Save,
  Languages,
  Info,
  Mail,
  ShieldCheck,
  AlertCircle,
  Lock,
  ChevronDown,
  User,
  Check,
  LogIn,
  Download,
  BookOpen,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MobileSelect } from "@/components/ui/mobile-select";
import SettingRow from "@/components/SettingRow";
import ProfileCard from "@/components/ProfileCard";
import MobileHeader from "@/components/MobileHeader";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { useT, TRANSLATIONS } from "@/lib/i18n";
import { setSetting } from "@/lib/settingsStore";
import { bookLangLabel, BOOK_LANG_VALUES } from "@/lib/i18n-terms";
import { getAccountEmail, getDownloadedBookIds, addDownloadedBookId } from "@/lib/activeUser";
import { setThemeMode, getThemeState, subscribeToTheme } from "@/lib/themeEngine";
import { PageSpinner } from "@/components/Skeleton";
import {
  getBooks,
  getVideos,
  getDownloadedBooks,
  downloadMultiplePdfs,
} from "@/lib/offlineSync";

const ls = {
  get: (k, fb = "") => {
    try {
      return localStorage.getItem(k) || fb;
    } catch (e) {
      return fb;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  },
};

export default function Settings() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => getThemeState().isDark);
  const [notifications, setNotifications] = useState(true);
  const [language, setLanguage] = useState("العربية");
  const [appLang, setAppLang] = useState(() => ls.get("dev_app_lang", "ar"));
  const [verified, setVerified] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [allBooksList, setAllBooksList] = useState([]);
  const [offlineStats, setOfflineStats] = useState({
    books: 0,
    downloadedPdfs: 0,
    videos: 0,
  });
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });

  // All cards are closed by default, open upon click ("مقفلة عند الضغط عليه يفتح")
  const [openCards, setOpenCards] = useState({
    profile: false,
    lang: false,
    appearance: false,
    preferences: false,
    offline: false,
    security: false,
    about: false,
    logout: false,
  });

  const toggleCard = (key) => {
    setOpenCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const refreshOfflineStats = async () => {
    try {
      const [bks, vids, dlBooks] = await Promise.all([
        getBooks().catch(() => []),
        getVideos().catch(() => []),
        getDownloadedBooks().catch(() => []),
      ]);
      const em = getAccountEmail() || "guest@local";
      const localDlIds = getDownloadedBookIds(em) || [];
      const combinedDlSet = new Set([
        ...localDlIds,
        ...(dlBooks || []).map((b) => b.id).filter(Boolean),
      ]);
      setAllBooksList(bks || []);
      setOfflineStats({
        books: (bks || []).length,
        downloadedPdfs: combinedDlSet.size,
        videos: (vids || []).length,
      });
    } catch {}
  };

  useEffect(() => {
    loadUser();
    refreshOfflineStats();
    const unsub = subscribeToTheme(({ isDark }) => setDarkMode(isDark));
    const onVerified = () => {
      const em = getAccountEmail();
      setUserEmail(em || "");
      try {
        setVerified(!!em && localStorage.getItem(`email_verified_${em}`) === "1");
      } catch {}
    };
    const onLangChange = () => {
      setAppLang(ls.get("dev_app_lang", "ar"));
    };
    window.addEventListener("dau-email-verified", onVerified);
    window.addEventListener("dau-email-change", onVerified);
    window.addEventListener("app-lang-change", onLangChange);

    return () => {
      unsub();
      window.removeEventListener("dau-email-verified", onVerified);
      window.removeEventListener("dau-email-change", onVerified);
      window.removeEventListener("app-lang-change", onLangChange);
    };
  }, []);

  const loadUser = async () => {
    const savedNotif = ls.get("dau_notifications_enabled", "");
    const savedPrefLang = ls.get("dau_preferred_book_lang", "");
    if (savedNotif !== "") setNotifications(savedNotif !== "0");
    if (savedPrefLang) setLanguage(savedPrefLang);

    const u = await base44.auth.me().catch(() => null);
    if (u) {
      if (savedNotif === "" && u.notifications_enabled !== undefined) {
        setNotifications(u.notifications_enabled ?? true);
      }
      if (!savedPrefLang && u.preferred_language) {
        setLanguage(u.preferred_language || "العربية");
      }
    }
    const em = getAccountEmail(u) || u?.email;
    setUserEmail(em || "");
    const name = localStorage.getItem("dau_full_name") || u?.full_name || "";
    setUserName(name);
    try {
      setVerified(!!em && localStorage.getItem(`email_verified_${em}`) === "1");
    } catch (e) {}
    setLoading(false);
  };

  const handleToggleDark = (val) => {
    setDarkMode(val);
    setThemeMode(val ? "dark" : "light");
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    ls.set("dau_notifications_enabled", notifications ? "1" : "0");
    ls.set("dau_preferred_book_lang", language);
    await base44.auth
      .updateMe({
        notifications_enabled: notifications,
        preferred_language: language,
      })
      .catch(() => {});
    toast.success((t.savePreferences || "تم حفظ التفضيلات") + " ✓");
    setSaving(false);
  };

  const handleDownloadAllBooksOffline = async () => {
    if (downloadingAll) return;
    setDownloadingAll(true);
    try {
      const booksToDl = allBooksList.length > 0 ? allBooksList : await getBooks();
      const validBooks = (booksToDl || []).filter((b) => b.pdf_url);
      setDownloadProgress({ done: 0, total: validBooks.length });
      await downloadMultiplePdfs(validBooks, (prog) => {
        const done = typeof prog === "object" ? prog.done || 0 : Number(prog) || 0;
        const total =
          typeof prog === "object" ? prog.total || validBooks.length : validBooks.length;
        setDownloadProgress({ done, total });
      });
      const em = getAccountEmail() || "guest@local";
      for (const b of validBooks) {
        if (b?.id) addDownloadedBookId(em, b.id);
      }
      await refreshOfflineStats();
      toast.success((t.allBooksDownloaded || "جميع الكتب جاهزة للقراءة بلا إنترنت") + " ✓");
    } catch {
      toast.error(t.downloadFailed || "تعذر التنزيل، تحقق من الاتصال بالإنترنت");
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleSelectAppLang = (code) => {
    setAppLang(code);
    ls.set("dev_app_lang", code);
    setSetting("app_lang", code);
    window.dispatchEvent(new Event("app-lang-change"));
    const nextT = TRANSLATIONS[code] || t;
    toast.success((nextT.applyLang || t.applyLang || "تم تطبيق اللغة") + " ✓");
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem("dau_account_email");
      localStorage.removeItem("dau_full_name");
      localStorage.removeItem("base44_access_token");
      localStorage.removeItem("token");
      window.dispatchEvent(new Event("dau-email-change"));
      window.dispatchEvent(new Event("dau-email-verified"));
      window.dispatchEvent(new Event("dau-avatar-change"));
    } catch (e) {}

    try {
      await base44.auth.logout("/").catch(() => {});
    } catch (e) {}

    toast.success(t.logoutSuccess || "تم تسجيل الخروج بنجاح ✓");
    setTimeout(() => {
      window.location.href = "/";
    }, 400);
  };

  if (loading) return <PageSpinner />;

  const appLangNames = {
    ar: "العربية",
    en: "English",
    fr: "Français",
    ur: "اردو",
    hi: "हिंदी",
    tr: "Türkçe",
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8" dir={t.dir}>
      <MobileHeader title={t.settings} />

      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-foreground">
            {t.settings}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t.settingsSub}
          </p>
        </div>

        <Button
          asChild
          variant={userEmail ? "outline" : "default"}
          className="gap-2 rounded-[4px_20px_4px_20px] font-bold text-xs sm:text-sm px-5 h-10 shrink-0 self-start sm:self-auto shadow-xs"
        >
          <Link to="/login">
            <LogIn className="w-4 h-4" />
            <span>{userEmail ? (t.switchAccount || t.loginBtn) : t.loginBtn}</span>
          </Link>
        </Button>
      </div>

      <div className="space-y-4">
        {/* 1. Profile Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("profile")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
                <User className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-bold text-foreground truncate">
                    {t.profile || "الملف الشخصي"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.profile ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.profile && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6">
                  <ProfileCard />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 2. App Language Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("lang")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
                <Languages className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.appLangTitle || "لغة واجهة التطبيق"}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.lang ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.lang && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {[
                      { code: "ar", name: "العربية", native: "العربية" },
                      { code: "en", name: "English", native: "English" },
                      { code: "fr", name: "Français", native: "Français" },
                      { code: "ur", name: "اردو", native: "اردو" },
                      { code: "hi", name: "हिंदी", native: "हिंदी" },
                      { code: "tr", name: "Türkçe", native: "Türkçe" },
                    ].map(({ code, name, native }) => {
                      const active = appLang === code;
                      return (
                        <button
                          type="button"
                          key={code}
                          onClick={() => handleSelectAppLang(code)}
                          className={`flex items-center justify-between p-3.5 rounded-2xl border-2 transition-all text-start cursor-pointer active:scale-98 ${
                            active
                              ? "border-primary bg-primary/8 shadow-xs"
                              : "border-border/70 bg-card hover:border-primary/40 hover:bg-muted/40"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                              {native}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{name}</p>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                              active ? "bg-primary text-primary-foreground" : "border-2 border-border"
                            }`}
                          >
                            {active && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 3. Appearance Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("appearance")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
                {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.appearance || "المظهر والعرض"}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.appearance ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.appearance && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6">
                  <SettingRow
                    title={t.darkMode}
                    description={t.darkModeSub}
                    control={
                      <div className="flex items-center gap-2.5">
                        <Sun className="w-4 h-4 text-muted-foreground" />
                        <Switch checked={darkMode} onCheckedChange={handleToggleDark} />
                        <Moon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    }
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Preferences Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("preferences")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
                <Globe className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.preferences || "التفضيلات والمحتوى"}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.preferences ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.preferences && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6 space-y-5">
                  <SettingRow
                    icon={<Bell className="w-4 h-4 text-primary" />}
                    title={t.notifications}
                    description={t.notificationsSub}
                    control={
                      <Switch
                        checked={notifications}
                        onCheckedChange={setNotifications}
                      />
                    }
                  />

                  <div className="pt-2 border-t border-border/60">
                    <Label className="text-xs font-bold">{t.preferredLang}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                      {t.preferredLangSub}
                    </p>
                    <MobileSelect
                      value={language}
                      onValueChange={setLanguage}
                      placeholder={t.preferredLangPlaceholder}
                      triggerClassName="mt-1"
                      options={BOOK_LANG_VALUES.map((v) => ({
                        value: v,
                        label: bookLangLabel(v, t.langCode),
                      }))}
                    />
                  </div>

                  <Button
                    onClick={handleSavePreferences}
                    disabled={saving}
                    className="gap-2 rounded-[4px_20px_4px_20px] font-bold"
                  >
                    <Save className="w-4 h-4" /> {t.savePreferences}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 5. Security & Privacy Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("security")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-xs">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.securityTitle || "الأمان والخصوصية"}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.security ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.security && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-muted/30 border border-border/60">
                    {verified ? (
                      <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-bold ${
                          verified
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {verified ? t.securityVerified : t.securityUnverified}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {verified ? t.lockedEmailNotice : t.securityPrivacySub}
                      </p>
                      {!verified && (
                        <Link
                          to="/login"
                          className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-[4px_20px_4px_20px] bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/95 transition-all shadow-xs"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>{t.loginBtn}</span>
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-3 px-1 text-xs text-muted-foreground leading-relaxed">
                    <Lock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p>{t.securityPrivacySub}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 5.5 Offline Library & Access Manager Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => {
              toggleCard("offline");
              refreshOfflineStats();
            }}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
                <Download className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.offlineCardTitle || "المكتبة والعمل بلا إنترنت"}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary font-mono">
                {offlineStats.downloadedPdfs}/{offlineStats.books}
              </span>
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.offline ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.offline && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6 space-y-4">
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {t.offlineCardSub ||
                      "تصفح واقرأ وابحث واحفظ كتبك ومفضلاتك في أي وقت حتى بدون اتصال بالإنترنت"}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-between sm:flex-col sm:items-start gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                        <BookOpen className="w-4 h-4 text-primary shrink-0" />
                        <span>{t.offlineBooksCached || "الكتب المخزنة للتصفح والبحث بلا نت"}</span>
                      </div>
                      <span className="text-lg font-black font-mono text-foreground">
                        {offlineStats.books}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-between sm:flex-col sm:items-start gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                        <Download className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{t.offlinePdfsDownloaded || "الكتب المحملة كاملة للقراءة بلا نت"}</span>
                      </div>
                      <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
                        {offlineStats.downloadedPdfs}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-between sm:flex-col sm:items-start gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                        <Video className="w-4 h-4 text-primary shrink-0" />
                        <span>{t.offlineVideosCached || "الفيديوهات والشورتات المخزنة بلا نت"}</span>
                      </div>
                      <span className="text-lg font-black font-mono text-foreground">
                        {offlineStats.videos}
                      </span>
                    </div>
                  </div>

                  {downloadingAll && downloadProgress.total > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-primary">
                        <span>{t.downloadingAllBooks || "جاري تنزيل الكتب للقراءة بلا نت..."}</span>
                        <span className="font-mono">
                          {downloadProgress.done} / {downloadProgress.total}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-200"
                          style={{
                            width: `${Math.round(
                              (downloadProgress.done / Math.max(1, downloadProgress.total)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    onClick={handleDownloadAllBooksOffline}
                    disabled={downloadingAll}
                    className="w-full gap-2 rounded-[4px_20px_4px_20px] font-bold"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {downloadingAll
                        ? t.downloadingAllBooks || "جاري تنزيل الكتب للقراءة بلا نت..."
                        : offlineStats.books > 0 &&
                          offlineStats.downloadedPdfs >= offlineStats.books
                        ? t.allBooksDownloaded || "جميع الكتب جاهزة للقراءة بلا إنترنت"
                        : t.downloadAllBooksBtn || "تنزيل جميع الكتب للقراءة بلا إنترنت"}
                    </span>
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 6. About & Contact Card (Collapsible) */}
        <div className="bg-card border border-border/80 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("about")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-muted/30 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs">
                <Info className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-foreground">
                  {t.aboutTitle} & {t.contactTitle}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.about ? "rotate-180 bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.about && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-border/60"
              >
                <div className="p-4 sm:p-6 space-y-4">
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {t.aboutContactSub}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Link
                      to="/about"
                      className="flex items-center justify-center gap-2 py-3 bg-primary/10 text-primary font-bold text-sm hover:bg-primary/15 transition-all rounded-[4px_20px_4px_20px] active:scale-98 shadow-xs"
                    >
                      <Info className="w-4 h-4" /> {t.aboutTitle}
                    </Link>
                    <Link
                      to="/contact"
                      className="flex items-center justify-center gap-2 py-3 bg-primary/10 text-primary font-bold text-sm hover:bg-primary/15 transition-all rounded-[4px_20px_4px_20px] active:scale-98 shadow-xs"
                    >
                      <Mail className="w-4 h-4" /> {t.contactTitle}
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 7. Logout Card (Collapsible) */}
        <div className="bg-card border border-destructive/20 rounded-3xl overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => toggleCard("logout")}
            className="w-full flex items-center justify-between p-4 sm:p-5 text-start hover:bg-destructive/5 transition-colors cursor-pointer select-none"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0 shadow-xs">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-destructive">
                  {t.logout}
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ms-2">
              <div
                className={`w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center transition-transform duration-300 ${
                  openCards.logout ? "rotate-180 bg-destructive/15 text-destructive" : "text-muted-foreground"
                }`}
              >
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {openCards.logout && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden border-t border-destructive/10"
              >
                <div className="p-4 sm:p-6 space-y-3">
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {t.logoutSub || "سيتم تسجيل خروجك من حسابك على هذا الجهاز."}
                  </p>
                  <Button
                    variant="destructive"
                    onClick={handleLogout}
                    className="gap-2 rounded-[4px_20px_4px_20px] font-bold"
                  >
                    <LogOut className="w-4 h-4" /> {t.logout}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}