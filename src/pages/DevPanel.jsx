import { useState, useEffect } from "react";
import {
  Shield, Lock, Eye, EyeOff,
  LayoutDashboard, BookOpen, Type, Palette, Layers, Sliders,
  Navigation, Image, Users, HardDrive, Archive, Activity, Zap, Settings, ChevronRight, Moon, Sun, Menu, X,
  ImagePlay, GalleryHorizontal, Paintbrush, Share2, Video, WifiOff, Wrench, FlaskConical, MessageCircle, Search,
  Cloud, CloudUpload, RefreshCw, Download, Copy, Smartphone, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { subscribeToSettings, flushAllPendingSettings, getSaveStatus, onSaveStatus } from "@/lib/settingsStore";
import { setThemeMode, getThemeState } from "@/lib/themeEngine";
import { auth, base44 } from "@/api/base44Client";
import { onAuthStateChanged } from "firebase/auth";
import { forceSyncNow } from "@/lib/contentSyncEngine";
import { apiUrl } from "@/lib/apiBase";

// ─── Section Components ───────────────────────────────────────────────────────
import DevDashboard from "@/components/dev/DevDashboard";
import DevBooks from "@/components/dev/DevBooks";
import DevFonts from "@/components/dev/DevFonts";
import DevColors from "@/components/dev/DevColors";
import DevCards from "@/components/dev/DevCards";
import DevAppDesign from "@/components/dev/DevAppDesign";
import DevNavigation from "@/components/dev/DevNavigation";
import DevBranding from "@/components/dev/DevBranding";
import DevUsers from "@/components/dev/DevUsers";
import DevStorage from "@/components/dev/DevStorage";
import DevBackup from "@/components/dev/DevBackup";
import DevLogs from "@/components/dev/DevLogs";
import DevSecurity from "@/components/dev/DevSecurity";
import DevPerformance from "@/components/dev/DevPerformance";
import DevSystemSettings from "@/components/dev/DevSystemSettings";
import DevBackgroundLibrary from "@/components/dev/DevBackgroundLibrary";
import DevBackgroundManager from "@/components/dev/DevBackgroundManager";
import DevTheme from "@/components/dev/DevTheme";
import DevSocialChannels from "@/components/dev/DevSocialChannels";
import DevVideos from "@/components/dev/DevVideos";
import DevContactSettings from "@/components/dev/DevContactSettings";
import DevOffline from "@/components/dev/DevOffline";
import DevMaintenance from "@/components/dev/DevMaintenance";
import DevTesting from "@/components/dev/DevTesting";

// ─── Font / Color exports (used by settingsStore) ─────────────────────────────
export { FONT_PRESETS, FONT_ROLES } from "@/lib/fontConstants";

// ─── Password ─────────────────────────────────────────────────────────────────
const DEV_PASSWORD_KEY = "dev_panel_password";
const DEFAULT_PASSWORD = "42891";
const getPassword = () => {
  try { return localStorage.getItem(DEV_PASSWORD_KEY) || DEFAULT_PASSWORD; } catch(e) { return DEFAULT_PASSWORD; }
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "dashboard",    label: "لوحة التحكم",      icon: LayoutDashboard },
  { id: "books",        label: "إدارة الكتب",       icon: BookOpen },
  { id: "fonts",        label: "إدارة الخطوط",      icon: Type },
  { id: "colors",       label: "الألوان والثيمات",   icon: Palette },
  { id: "cards",        label: "البطاقات والمكونات", icon: Layers },
  { id: "app_design",   label: "تصميم التطبيق",     icon: Sliders },
  { id: "navigation",   label: "إدارة التنقل",      icon: Navigation },
  { id: "branding",     label: "الشعار والهوية",     icon: Image },
  { id: "users",        label: "إدارة المستخدمين",   icon: Users },
  { id: "storage",      label: "إدارة التخزين",      icon: HardDrive },
  { id: "backup",       label: "النسخ الاحتياطي",    icon: Archive },
  { id: "logs",         label: "سجلات النشاط",       icon: Activity },
  { id: "security",     label: "مركز الأمان",        icon: Shield },
  { id: "performance",  label: "مركز الأداء",        icon: Zap },
  { id: "system",       label: "إعدادات النظام",     icon: Settings },
  { id: "theme",        label: "نظام الثيمات",        icon: Paintbrush },
  { id: "background",   label: "إدارة الخلفيات",     icon: ImagePlay },
  { id: "bg_library",   label: "مكتبة الخلفيات",     icon: GalleryHorizontal },
  { id: "social",        label: "قنوات التواصل",        icon: Share2 },
  { id: "videos",        label: "إدارة الفيديوهات",      icon: Video },
  { id: "contact",       label: "إدارة صفحة التواصل",   icon: MessageCircle },
  { id: "offline",       label: "إدارة وضع عدم الاتصال",  icon: WifiOff },
  { id: "maintenance",   label: "أدوات الصيانة",           icon: Wrench },
  { id: "testing",       label: "أدوات الاختبار",          icon: FlaskConical },
];

const TAB_GROUPS = [
  { title: "المحتوى", ids: ["books", "videos", "social", "contact"] },
  { title: "التصميم والمظهر", ids: ["fonts", "colors", "cards", "app_design", "theme", "branding", "navigation", "background", "bg_library"] },
  { title: "النظام والأدوات", ids: ["users", "storage", "backup", "logs", "security", "performance", "system", "offline", "maintenance", "testing"] },
];

export default function DevPanel() {
  const [unlocked, setUnlocked]           = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPwd, setShowPwd]             = useState(false);
  const [activeTab, setActiveTab]         = useState("dashboard");
  const [sidebarOpen, setSidebarOpen]     = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);
  const [tabSearch, setTabSearch]         = useState("");
  const [darkMode, setDarkMode]           = useState(() => getThemeState().isDark);
  const [fbUser, setFbUser]               = useState(() => auth.currentUser);
  const [syncingCloud, setSyncingCloud]   = useState(false);
  const [saveStatus, setSaveStatus]       = useState(() => getSaveStatus());
  const [aabDialogOpen, setAabDialogOpen] = useState(false);
  const [aabInfo, setAabInfo]             = useState(null);
  const [aabDownloading, setAabDownloading] = useState(false);
  const [aabProgress, setAabProgress]     = useState(0);
  const [aabCopied, setAabCopied]         = useState(false);
  const [keystoreFile, setKeystoreFile]   = useState(null);
  const [keystorePass, setKeystorePass]   = useState("");
  const [keyAlias, setKeyAlias]           = useState("");
  const [keyPass, setKeyPass]             = useState("");
  const [resigningAab, setResigningAab]   = useState(false);

  const loadAabInfo = async () => {
    try {
      const res = await fetch(apiUrl("/api/aab-info"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAabInfo(data);
      }
    } catch {}
  };

  useEffect(() => {
    loadAabInfo();
  }, []);

  // Sync dark mode
  useEffect(() => {
    const unsub = subscribeToSettings(() => setDarkMode(getThemeState().isDark));
    const unsubStatus = onSaveStatus((s) => setSaveStatus(s));
    return () => { unsub(); unsubStatus(); };
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setFbUser(u));
  }, []);

  const handleSyncCloud = async () => {
    setSyncingCloud(true);
    try {
      const settingsRes = await flushAllPendingSettings();
      await Promise.allSettled([
        base44.entities.Book.flushPending?.(),
        base44.entities.Video.flushPending?.(),
        base44.entities.VideoChannel.flushPending?.(),
        base44.entities.SocialChannel.flushPending?.(),
      ]);
      await forceSyncNow();
      if (settingsRes?.ok === false) {
        toast.warning("تعذر حفظ بعض الإعدادات سحابياً — تحقق من اتصال الإنترنت");
      } else {
        toast.success("تمت المزامنة بنجاح وحفظ كافة التعديلات ✓");
      }
    } catch (e) {
      toast.error("حدث خطأ أثناء المزامنة: " + (e?.message || ""));
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await base44.auth.signInWithGoogle();
      toast.success("تم تسجيل الدخول كمسؤول بنجاح ✓");
      await forceSyncNow();
    } catch (e) {
      if (e?.code === "POPUP_CLOSED") return;
      toast.error(e?.message || "تعذر تسجيل الدخول عبر Google حالياً");
    }
  };

  const handleUnlock = () => {
    if (passwordInput === getPassword()) setUnlocked(true);
    else toast.error("كلمة المرور غير صحيحة");
  };

  const handleToggleDark = () => {
    setThemeMode(getThemeState().isDark ? "light" : "dark");
  };

  const getDirectAabUrl = () => {
    const resolved = apiUrl("/api/download-aab");
    if (resolved.startsWith("http")) return resolved;
    return `${window.location.origin}${resolved}`;
  };

  const handleDownloadAabBlob = async () => {
    if (aabDownloading) return;
    setAabDownloading(true);
    setAabProgress(0);
    try {
      const res = await fetch(apiUrl("/api/download-aab"), { cache: "no-store" });
      if (!res.ok) {
        throw new Error("ملف AAB غير متوفر حالياً");
      }
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/html")) {
        throw new Error("استجابة غير صالحة من الخادم");
      }
      const contentLength = Number(res.headers.get("content-length") || 0);
      let blob;
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            if (contentLength > 0) {
              setAabProgress(Math.min(100, Math.round((received / contentLength) * 100)));
            }
          }
        }
        blob = new Blob(chunks, { type: "application/octet-stream" });
      } else {
        blob = await res.blob();
      }
      if (!blob || blob.size < 10000) {
        throw new Error("حجم الملف المحمّل غير مكتمل");
      }
      setAabProgress(100);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "dar-al-tawhid.aab";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 4000);
      toast.success("بدأ تنزيل ملف dar-al-tawhid.aab ✓");
    } catch (err) {
      toast.error((err?.message || "تعذر تنزيل الملف من داخل الإطار") + " — جرب نسخ الرابط المباشر");
    } finally {
      setAabDownloading(false);
    }
  };

  const handleCopyAabUrl = async () => {
    const url = getDirectAabUrl();
    try {
      await navigator.clipboard.writeText(url);
      setAabCopied(true);
      toast.success("تم نسخ رابط التحميل المباشر ✓ — الصقه في متصفحك لتنزيل الملف");
      setTimeout(() => setAabCopied(false), 3000);
    } catch {
      toast.info(url);
    }
  };

  const handleResignAab = async (e) => {
    e?.preventDefault?.();
    if (!keystoreFile) {
      toast.error("يرجى اختيار ملف المفتاح الأصلي (release.keystore أو .jks)");
      return;
    }
    if (!keystorePass.trim()) {
      toast.error("يرجى إدخال كلمة مرور المفتاح (Keystore Password)");
      return;
    }
    setResigningAab(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("تعذر قراءة ملف المفتاح"));
        reader.readAsDataURL(keystoreFile);
      });
      const res = await fetch(apiUrl("/api/resign-aab"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keystoreBase64: base64,
          keystorePassword: keystorePass.trim(),
          keyAlias: keyAlias.trim(),
          keyPassword: (keyPass || keystorePass).trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "فشل إعادة توقيع ملف AAB");
      }
      await loadAabInfo();
      if (data.matchesExpectedKey) {
        toast.success("تم توقيع حزمة AAB بالمفتاح الأصلي المطابق لـ Google Play بنجاح ✓");
      } else {
        toast.warning(`تم توقيع الحزمة ببصمة: ${data.sha1}`);
      }
    } catch (err) {
      toast.error(err?.message || "تعذر توقيع الحزمة");
    } finally {
      setResigningAab(false);
    }
  };

  // ── Lock screen ──
  if (!unlocked) return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-card border border-border rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary/10 mb-4 rounded-2xl w-20 h-20 flex items-center justify-center ring-4 ring-primary/20">
            <Shield className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-2xl font-black">مركز التحكم</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">لوحة المطور المتقدمة — Enterprise Edition</p>
        </div>
        <div className="space-y-4">
          <div className="relative">
            <Input type={showPwd ? "text" : "password"} value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="كلمة المرور" className="h-12 rounded-xl pl-10 text-center text-lg tracking-widest" />
            <button onClick={() => setShowPwd(!showPwd)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button onClick={handleUnlock} className="w-full h-12 rounded-xl font-bold text-base gap-2">
            <Shield className="w-4 h-4" /> دخول إلى مركز التحكم
          </Button>
        </div>
      </motion.div>
    </div>
  );

  const ActiveSection = {
    dashboard:   DevDashboard,
    books:       DevBooks,
    fonts:       DevFonts,
    colors:      DevColors,
    cards:       DevCards,
    app_design:  DevAppDesign,
    navigation:  DevNavigation,
    branding:    DevBranding,
    users:       DevUsers,
    storage:     DevStorage,
    backup:      DevBackup,
    logs:        DevLogs,
    security:    DevSecurity,
    performance:  DevPerformance,
    system:       DevSystemSettings,
    theme:        DevTheme,
    background:   DevBackgroundManager,
    bg_library:   DevBackgroundLibrary,
    social:        DevSocialChannels,
    videos:        DevVideos,
    contact:       DevContactSettings,
    offline:       DevOffline,
    maintenance:   DevMaintenance,
    testing:       DevTesting,
  }[activeTab] || DevDashboard;

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir="rtl">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 256, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 fixed md:relative inset-y-0 right-0 bg-card border-l border-border flex flex-col overflow-hidden z-40 shadow-2xl md:shadow-none"
            style={{ width: 256 }}
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black truncate">مركز التحكم</p>
                  <p className="text-[10px] text-muted-foreground">Enterprise Edition</p>
                </div>
              </div>
            </div>

            {/* Tab Search */}
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={tabSearch}
                  onChange={(e) => setTabSearch(e.target.value)}
                  placeholder="بحث سريع في الأقسام..."
                  className="w-full h-9 rounded-lg bg-muted border border-border pr-9 pl-3 text-xs outline-none focus:ring-1 focus:ring-primary/40 text-right" />
              </div>
            </div>

            {/* Nav Items */}
            <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {(() => {
                const q = tabSearch.trim();
                const select = (id) => {
                  setActiveTab(id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                };
                const TabBtn = ({ tab }) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button onClick={() => select(tab.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}>
                      <tab.icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-right truncate">{tab.label}</span>
                      {isActive && <ChevronRight className="w-3 h-3 shrink-0 rotate-180" />}
                    </button>
                  );
                };
                if (q) {
                  const found = TABS.filter(tab => tab.label.includes(q));
                  return found.length > 0
                    ? found.map(tab => <TabBtn key={tab.id} tab={tab} />)
                    : <p className="text-center text-xs text-muted-foreground py-6">لا توجد نتائج</p>;
                }
                return (
                  <>
                    <TabBtn tab={TABS[0]} />
                    {TAB_GROUPS.map(group => (
                      <div key={group.title}>
                        <p className="text-[10px] font-bold text-muted-foreground/70 px-3 pt-4 pb-1">{group.title}</p>
                        {group.ids.map(id => {
                          const tab = TABS.find(t => t.id === id);
                          return tab ? <TabBtn key={tab.id} tab={tab} /> : null;
                        })}
                      </div>
                    ))}
                  </>
                );
              })()}
            </nav>

            {/* Sidebar Footer */}
            <div className="p-3 border-t border-border space-y-2">
              <button onClick={handleToggleDark}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{darkMode ? "الوضع النهاري" : "الوضع الليلي"}</span>
              </button>
              <button onClick={() => { setUnlocked(false); setPasswordInput(""); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Lock className="w-4 h-4" />
                <span>قفل اللوحة</span>
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-muted transition-colors">
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2">
            {(() => { const t = TABS.find(t => t.id === activeTab); return t ? <><t.icon className="w-4 h-4 text-primary" /><h1 className="font-bold text-sm">{t.label}</h1></> : null; })()}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { loadAabInfo(); setAabDialogOpen(true); }}
              className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
              title="تحميل حزمة الأندرويد الموقعة AAB"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">ملف AAB</span>
              {aabInfo?.available && (
                <span className="text-[10px] opacity-80 hidden md:inline">({aabInfo.sizeMB} MB)</span>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncCloud}
              disabled={syncingCloud}
              className="h-8 text-xs gap-1.5"
              title="مزامنة التعديلات سحابياً"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingCloud ? "animate-spin text-primary" : ""}`} />
              <span className="hidden sm:inline">مزامنة سحابية</span>
            </Button>
            {fbUser ? (
              <span className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-lg border border-emerald-500/20 flex items-center gap-1.5 font-medium">
                <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden md:inline">{fbUser.email}</span>
                <span className="md:hidden">متصل سحابياً</span>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoogleAuth}
                className="h-8 text-xs gap-1.5 text-primary border border-primary/20 hover:bg-primary/10"
                title="تسجيل الدخول كمسؤول لتفعيل المزامنة السحابية المباشرة مع Firebase"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">ربط حساب Google السحابي</span>
              </Button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
              <div className={`w-2 h-2 rounded-full ${
                saveStatus === "saving" ? "bg-amber-500 animate-pulse" :
                saveStatus === "error"  ? "bg-red-500" :
                saveStatus === "saved"  ? "bg-emerald-500" :
                "bg-emerald-500/80"
              }`} />
              <span className="hidden sm:inline">
                {saveStatus === "saving" ? "جاري الحفظ..." :
                 saveStatus === "error"  ? "بانتظار الاتصال" :
                 saveStatus === "saved"  ? "تم الحفظ ✓" :
                 "مزامنة تلقائية"}
              </span>
            </div>
          </div>
        </header>

        {/* Section Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <ActiveSection />
        </main>
      </div>

      {/* AAB Download & Keystore Re-Signing Modal */}
      <Dialog open={aabDialogOpen} onOpenChange={setAabDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              حزمة التطبيق الموقّعة (AAB) وتطابق مفتاح Google Play
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-1">
            {aabInfo?.available ? (
              <>
                <div className="p-3.5 rounded-xl bg-muted/60 border border-border text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">اسم الملف:</span>
                    <span className="font-bold font-mono" dir="ltr">dar-al-tawhid.aab</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Package Name:</span>
                    <span className="font-bold font-mono text-primary" dir="ltr">com.daraltawhid.app</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الحجم:</span>
                    <span className="font-bold">{aabInfo.sizeMB} MB</span>
                  </div>
                  <div className="pt-1.5 border-t border-border/60 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">بصمة SHA-1 الحالية للملف:</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          aabInfo.matchesExpectedKey
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {aabInfo.matchesExpectedKey ? "مطابق لـ Google Play ✓" : "مفتاح مؤقت (يتطلب مفتاحك الأصلي)"}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] break-all bg-background/80 p-1.5 rounded border border-border/50" dir="ltr">
                      {aabInfo.sha1 || "غير محدد"}
                    </div>
                    {!aabInfo.matchesExpectedKey && aabInfo.expectedSha1 && (
                      <div className="space-y-0.5 pt-1">
                        <span className="text-[10px] text-muted-foreground">البصمة المطلوبة في Google Play Console:</span>
                        <div className="font-mono text-[10px] break-all text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 p-1.5 rounded border border-emerald-500/20" dir="ltr">
                          {aabInfo.expectedSha1}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Option A: 1-Click Certificate Download for Google Play Upload Key Reset */}
                <div className="p-3.5 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 space-y-2.5 text-xs">
                  <div className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-between">
                    <span>الحل النهائي لقبول الملف في Google Play (خطوة واحدة فقط) ✓</span>
                  </div>
                  <div className="text-[11px] text-foreground space-y-1 leading-relaxed bg-background/80 p-2.5 rounded-lg border border-emerald-500/20">
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">لماذا تظهر رسالة الخطأ في صفحة الصاروخ (🚀)؟</p>
                    <p>لأن Google Play ما زال ينتظر المفتاح القديم. لتبديله بمفتاحنا الدائم على الآيباد:</p>
                    <ol className="list-decimal list-inside space-y-1 pt-1 font-medium">
                      <li>اضغط الزر الأخضر بالأسفل لتحميل ملف الشهادة (<span className="font-mono" dir="ltr">upload_certificate.pem</span>).</li>
                      <li>في صفحة Google Play Console، اضغط على <strong>أيقونة الدرع (🛡️)</strong> الموجودة في القائمة اليسرى <strong>فوق أيقونة الصاروخ الأزرق (🚀) مباشرةً</strong>.</li>
                      <li>اضغط على <strong>Settings / الإعدادات</strong> بجانب <strong>App signing</strong> ثم اختر <strong>Request upload key reset</strong>.</li>
                      <li>اختر <strong>I lost my upload key</strong> وارفع ملف <span className="font-mono" dir="ltr">upload_certificate.pem</span> ثم اضغط <strong>Request</strong>.</li>
                    </ol>
                  </div>
                  <a
                    href={apiUrl("/api/download-upload-pem")}
                    download="upload_certificate.pem"
                    className="w-full h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center justify-center gap-1.5 text-xs font-bold shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    1. تحميل ملف الشهادة (upload_certificate.pem)
                  </a>
                </div>

                {/* Option B: Upload Original Keystore to Re-Sign AAB & Save Permanently */}
                <form onSubmit={handleResignAab} className="p-3.5 rounded-xl border border-primary/30 bg-primary/5 space-y-2.5 text-xs">
                  <div className="font-bold text-foreground flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-primary" />
                    أو ارفع مفتاحك القديم مرة واحدة (سيُحفظ تلقائياً لكل المرات القادمة)
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    إذا كان ملف المفتاح القديم (<span className="font-mono" dir="ltr">C5:C3:CB...</span>) موجوداً لديك، ارفعه هنا مرة واحدة فقط وسيتم توقيع الحزمة وحفظه تلقائياً لكل الإصدارات المستقبلية:
                  </p>
                  <div className="space-y-2">
                    <Input
                      type="file"
                      accept=".keystore,.jks,.p12,.pfx"
                      onChange={(e) => setKeystoreFile(e.target.files?.[0] || null)}
                      className="h-9 text-xs bg-background cursor-pointer"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        type="password"
                        placeholder="كلمة مرور الـ Keystore *"
                        value={keystorePass}
                        onChange={(e) => setKeystorePass(e.target.value)}
                        className="h-9 text-xs bg-background"
                        dir="ltr"
                      />
                      <Input
                        type="text"
                        placeholder="الـ Alias (اتركه فارغاً للكشف التلقائي)"
                        value={keyAlias}
                        onChange={(e) => setKeyAlias(e.target.value)}
                        className="h-9 text-xs bg-background"
                        dir="ltr"
                      />
                    </div>
                    <Input
                      type="password"
                      placeholder="كلمة مرور الـ Key (اتركها فارغة إذا كانت مطابقة للـ Keystore)"
                      value={keyPass}
                      onChange={(e) => setKeyPass(e.target.value)}
                      className="h-9 text-xs bg-background"
                      dir="ltr"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={resigningAab || !keystoreFile || !keystorePass.trim()}
                    variant="secondary"
                    className="w-full h-9 rounded-lg text-xs font-bold gap-1.5 border border-primary/30"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${resigningAab ? "animate-spin" : ""}`} />
                    {resigningAab ? "جاري توقيع ملف AAB بمفتاحك..." : "توقيع ملف AAB بالمفتاح المرفوع الآن"}
                  </Button>
                </form>

                {aabDownloading && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">جاري التحميل...</span>
                      <span className="font-bold text-primary tabular-nums">{aabProgress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-200" style={{ width: `${aabProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Button
                    onClick={handleDownloadAabBlob}
                    disabled={aabDownloading}
                    className="w-full h-11 rounded-xl font-bold gap-2"
                  >
                    <Download className="w-4 h-4" />
                    {aabDownloading ? `جاري التنزيل (${aabProgress}%)...` : "تنزيل ملف AAB الآن"}
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={getDirectAabUrl()}
                      download="dar-al-tawhid.aab"
                      className="h-9 rounded-xl border border-border bg-card hover:bg-muted transition-colors flex items-center justify-center gap-1.5 text-xs font-bold"
                    >
                      <Download className="w-3.5 h-3.5 text-primary" />
                      تنزيل عبر المتصفح
                    </a>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCopyAabUrl}
                      className="h-9 rounded-xl text-xs font-bold gap-1.5"
                    >
                      {aabCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {aabCopied ? "تم النسخ ✓" : "نسخ الرابط المباشر"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                ملف AAB غير جاهز بعد. سيتم تحديث الحالة فور اكتمال البناء.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}