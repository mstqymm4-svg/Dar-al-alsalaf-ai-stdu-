import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Camera,
  Heart,
  Download,
  BookOpen,
  Loader2,
  Save,
  Activity,
  Eye,
  LogIn,
  ShieldCheck,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ProfileStatChip from "@/components/profile/ProfileStatChip";
import RecentReadsList from "@/components/profile/RecentReadsList";
import ProfileQuickLinks from "@/components/profile/ProfileQuickLinks";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getAccountEmail,
  getDownloadedBookIds,
  getAvatarUrl,
  setAvatarUrl,
  getWatchedVideoIds,
} from "@/lib/activeUser";
import { getFavoriteIds, getBook } from "@/lib/offlineSync";

const FULL_NAME_KEY = "dau_full_name";

const initials = (name, email) => {
  const src = (name || email || "").trim();
  return src ? src[0].toUpperCase() : "•";
};

export default function ProfileCard() {
  const t = useT();
  const fileRef = useRef(null);
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState(() => {
    try {
      return localStorage.getItem(FULL_NAME_KEY) || "";
    } catch {
      return "";
    }
  });

  // Current linked account email
  const [linkedEmail, setLinkedEmail] = useState(() => getAccountEmail());
  const [avatar, setAvatar] = useState(() => getAvatarUrl(getAccountEmail()));
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState({ favs: 0, dls: 0, reading: 0, watched: 0 });
  const [recentReads, setRecentReads] = useState([]);

  useEffect(() => {
    load();
  }, []);

  // Listen for email verification & logout events across the app
  useEffect(() => {
    const onAuthEvent = () => {
      load();
    };
    window.addEventListener("dau-email-verified", onAuthEvent);
    window.addEventListener("dau-email-change", onAuthEvent);
    window.addEventListener("dau-avatar-change", onAuthEvent);
    return () => {
      window.removeEventListener("dau-email-verified", onAuthEvent);
      window.removeEventListener("dau-email-change", onAuthEvent);
      window.removeEventListener("dau-avatar-change", onAuthEvent);
    };
  }, []);

  const load = async () => {
    const rawUser = await base44.auth.me().catch(() => null);
    const u =
      rawUser && typeof rawUser === "object" && (rawUser.email || rawUser.full_name)
        ? rawUser
        : null;
    setUser(u);

    let savedName = "";
    try {
      savedName = localStorage.getItem(FULL_NAME_KEY) || "";
    } catch {}
    const nameToUse = u?.full_name || savedName || "";
    setFullName(nameToUse);

    const em = (getAccountEmail(u) || "").trim();
    setLinkedEmail(em);
    setAvatar(em ? getAvatarUrl(em) : "");

    refreshStats(em);
    loadRecentReads();
  };

  const refreshStats = async (email) => {
    const favs = await getFavoriteIds(email).catch(() => []);
    let reading = 0;
    try {
      reading = Object.keys(localStorage).filter((k) => k.startsWith("lastpage_")).length;
    } catch {}
    setStats({
      favs: favs.length,
      dls: getDownloadedBookIds(email).length,
      reading,
      watched: getWatchedVideoIds(email).length,
    });
  };

  const loadRecentReads = async () => {
    try {
      const entries = Object.keys(localStorage)
        .filter((k) => k.startsWith("lastpage_"))
        .map((k) => {
          const id = k.slice("lastpage_".length);
          return {
            id,
            page: Number(localStorage.getItem(k)) || 1,
            ts: Number(localStorage.getItem(`lastts_${id}`)) || 0,
          };
        })
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 3);
      const books = await Promise.all(entries.map((e) => getBook(e.id).catch(() => null)));
      setRecentReads(entries.map((e, i) => ({ ...e, book: books[i] })).filter((r) => r.book));
    } catch {}
  };

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      let finalUrl = "";
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        finalUrl = await fileToDataUrl(file);
      } else {
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          finalUrl = file_url;
        } catch {
          finalUrl = await fileToDataUrl(file);
        }
      }
      if (!finalUrl) throw new Error("Empty avatar URL");
      const em = getAccountEmail(user) || linkedEmail.trim();
      setAvatarUrl(em, finalUrl);
      setAvatar(finalUrl);
      window.dispatchEvent(new Event("dau-avatar-change"));
      toast.success(t.changePhoto + " ✓");
    } catch {
      toast.error(t.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  // Save Full Name
  const handleSaveName = async () => {
    const trimmed = fullName.trim();
    if (!trimmed) {
      toast.error(t.pleaseEnterFullName || "يرجى إدخال الاسم الكامل");
      return;
    }
    setSavingName(true);
    try {
      try {
        localStorage.setItem(FULL_NAME_KEY, trimmed);
      } catch {}
      base44.auth.updateMe({ full_name: trimmed }).catch(() => {});
      toast.success(t.nameSavedSuccess || "تم حفظ الاسم بنجاح ✓");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-card border border-border rounded-2xl overflow-hidden"
    >
      {/* Banner */}
      <div className="h-32 bg-gradient-to-l from-primary/35 via-primary/15 to-accent/20 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_80%_20%,hsl(var(--accent)/0.4),transparent_60%)]" />
        <div className="absolute -bottom-8 -start-8 w-32 h-32 rounded-full bg-primary/10" />
        <div className="absolute top-3 end-10 w-14 h-14 rounded-full border-[3px] border-foreground/10" />
        <div className="absolute top-6 start-16 w-2 h-2 rounded-full bg-accent/50" />
        <div className="absolute bottom-4 end-1/3 w-1.5 h-1.5 rounded-full bg-primary/30" />
      </div>

      {/* Avatar + identity */}
      <div className="px-4 sm:px-6 -mt-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="relative self-start">
            <div className="p-[3px] rounded-full bg-gradient-to-br from-primary via-accent to-primary shadow-lg">
              <div className="w-20 h-20 rounded-full ring-2 ring-card bg-primary/10 overflow-hidden flex items-center justify-center">
                {avatar ? (
                  <img src={avatar} alt={t.profile} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-black text-primary">
                    {initials(fullName, linkedEmail)}
                  </span>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              title={t.changePhoto}
              className="absolute bottom-0 -end-1 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="pb-1 min-w-0 w-full sm:w-auto sm:text-end">
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <p className="font-bold text-base text-foreground break-words">
                {(fullName && fullName !== "مستخدم دار العلوم" && fullName !== "مستخدم DAR AL TAWHID" && (t.langCode === "ar" || fullName !== "محمد هارون نور"))
                  ? fullName
                  : (t.userDefaultName || "مستخدم DAR AL TAWHID")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground break-all mt-0.5" dir="ltr">
              {linkedEmail || t.noLinkedEmail}
            </p>
          </div>
        </div>
      </div>

      {/* Profile Form Fields + Login Button */}
      <div className="px-4 sm:px-6 pt-5 space-y-5">
        {/* Login / Account Action Card */}
        {!linkedEmail ? (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <p className="text-sm font-bold text-foreground">
                {t.loginToSyncTitle}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t.loginToSyncSub}
              </p>
            </div>
            <Button
              asChild
              className="gap-2 rounded-[4px_20px_4px_20px] font-bold text-xs px-5 h-10 shrink-0 w-full sm:w-auto shadow-sm"
            >
              <Link to="/login">
                <LogIn className="w-4 h-4" />
                <span>{t.loginBtn}</span>
              </Link>
            </Button>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-emerald-500/8 border border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  {t.loggedInStatus}
                </p>
              </div>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl text-xs shrink-0 h-9 w-full sm:w-auto"
            >
              <Link to="/login">
                <LogIn className="w-3.5 h-3.5" />
                <span>{t.switchAccount || t.loginBtn}</span>
              </Link>
            </Button>
          </div>
        )}

        {/* Full Name */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold">{t.fullName}</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t.fullNamePlaceholder || "اكتب اسمك الكامل..."}
              className="rounded-xl bg-background text-sm flex-1 h-10"
            />
            <Button
              onClick={handleSaveName}
              disabled={savingName}
              className="gap-1.5 rounded-xl shrink-0 text-xs px-4 h-10 w-full sm:w-auto"
            >
              {savingName ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{t.saveName || "حفظ الاسم"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 sm:px-6 pt-6">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground mb-3">
          <Activity className="w-4 h-4 text-primary" /> {t.myActivity}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <ProfileStatChip
            icon={<Heart className="w-4 h-4" />}
            value={stats.favs}
            label={t.accFavorites}
            tone="accent"
            delay={0}
          />
          <ProfileStatChip
            icon={<Download className="w-4 h-4" />}
            value={stats.dls}
            label={t.accOfflineBooks}
            tone="primary"
            delay={0.05}
          />
          <ProfileStatChip
            icon={<BookOpen className="w-4 h-4" />}
            value={stats.reading}
            label={t.booksRead}
            tone="success"
            delay={0.1}
          />
          <ProfileStatChip
            icon={<Eye className="w-4 h-4" />}
            value={stats.watched}
            label={t.watchedVideos}
            tone="muted"
            delay={0.15}
          />
        </div>
      </div>

      {/* Quick links */}
      <div className="px-5 sm:px-6 pt-4">
        <ProfileQuickLinks />
      </div>

      {/* Recent reads */}
      {recentReads.length > 0 && (
        <div className="px-5 sm:px-6 pt-5 pb-6">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground mb-3">
            <BookOpen className="w-4 h-4 text-primary" /> {t.lastRead}
          </h3>
          <RecentReadsList items={recentReads} />
        </div>
      )}
      {recentReads.length === 0 && <div className="pb-6" />}
    </motion.div>
  );
}
