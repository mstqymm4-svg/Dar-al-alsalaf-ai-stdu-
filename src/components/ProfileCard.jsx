import { useState, useEffect, useRef } from "react";
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
  Lock,
  ShieldCheck,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import EmailVerification from "@/components/EmailVerification";
import ProfileStatChip from "@/components/profile/ProfileStatChip";
import RecentReadsList from "@/components/profile/RecentReadsList";
import ProfileQuickLinks from "@/components/profile/ProfileQuickLinks";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getAccountEmail,
  setAccountEmail,
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
  const [emailInput, setEmailInput] = useState(() => getAccountEmail());
  const [avatar, setAvatar] = useState(() => getAvatarUrl(getAccountEmail()));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendSignal, setSendSignal] = useState(0);
  const [stats, setStats] = useState({ favs: 0, dls: 0, reading: 0, watched: 0 });
  const [recentReads, setRecentReads] = useState([]);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    load();
  }, []);

  // Verified emails are locked — re-check whenever the email changes or a
  // verification just succeeded elsewhere in the card
  useEffect(() => {
    const em = emailInput.trim() || getAccountEmail(user);
    try {
      setVerified(!!em && localStorage.getItem(`email_verified_${em}`) === "1");
    } catch {
      setVerified(false);
    }
  }, [emailInput, user]);

  useEffect(() => {
    const onVerified = () => {
      const em = emailInput.trim() || getAccountEmail(user);
      try {
        setVerified(!!em && localStorage.getItem(`email_verified_${em}`) === "1");
      } catch {}
    };
    window.addEventListener("dau-email-verified", onVerified);
    return () => window.removeEventListener("dau-email-verified", onVerified);
  }, [emailInput, user]);

  const load = async () => {
    const rawUser = await base44.auth.me().catch(() => null);
    const u = rawUser && typeof rawUser === "object" && (rawUser.email || rawUser.full_name) ? rawUser : null;
    setUser(u);

    let savedName = "";
    try {
      savedName = localStorage.getItem(FULL_NAME_KEY) || "";
    } catch {}
    const nameToUse = u?.full_name || savedName || "";
    if (nameToUse) setFullName(nameToUse);

    const em = getAccountEmail(u);
    if (em) {
      setEmailInput(em);
      setAvatar(getAvatarUrl(em));
    }
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

  const handleAvatarPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const em = getAccountEmail(user) || emailInput.trim();
      setAvatarUrl(em, file_url);
      setAvatar(file_url);
      window.dispatchEvent(new Event("dau-avatar-change"));
      toast.success(t.changePhoto + " ✓");
    } catch {
      toast.error(t.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    const em = emailInput.trim();
    if (!em || !/^\S+@\S+\.\S+$/.test(em)) {
      toast.error(t.evInvalidEmail);
      return;
    }
    setSaving(true);
    try {
      try {
        localStorage.setItem(FULL_NAME_KEY, fullName.trim());
      } catch {}
      // Update remote profile in background without blocking local save + verification code
      base44.auth.updateMe({ full_name: fullName.trim() }).catch(() => {});

      const prev = getAccountEmail(user);
      if (prev && prev !== em) {
        const av = getAvatarUrl(prev);
        if (av) setAvatarUrl(em, av);
      }
      setAccountEmail(em);
      setEmailInput(em);

      const isAlreadyVerified = (() => {
        try {
          return localStorage.getItem(`email_verified_${em}`) === "1";
        } catch {
          return false;
        }
      })();

      if (!isAlreadyVerified) {
        setSendSignal(Date.now()); // triggers EmailVerification modal to send code via Nodemailer
      }
      await refreshStats(em);
      toast.success(t.saveChanges + " ✓");
    } finally {
      setSaving(false);
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
      <div className="px-5 sm:px-6 -mt-10">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div className="relative self-start">
            <div className="p-[3px] rounded-full bg-gradient-to-br from-primary via-accent to-primary shadow-lg">
              <div className="w-20 h-20 rounded-full ring-2 ring-card bg-primary/10 overflow-hidden flex items-center justify-center">
                {avatar ? (
                  <img src={avatar} alt={t.profile} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-black text-primary">
                    {initials(fullName, emailInput)}
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
          <div className="pb-1 min-w-0 sm:text-end">
            <div className="flex items-center gap-1.5 sm:justify-end">
              <p className="font-bold text-base text-foreground truncate">
                {fullName || t.profile}
              </p>
              {verified && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                  <ShieldCheck className="w-3 h-3" /> {t.verifiedBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{emailInput}</p>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="px-5 sm:px-6 pt-5 space-y-4">
        <div>
          <Label>{t.fullName}</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label>{t.email}</Label>
          </div>
          <div className="relative mt-1.5">
            <Input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              type="email"
              inputMode="email"
              placeholder="example@gmail.com"
              disabled={verified}
              className="pe-10"
            />

            {verified && (
              <Lock className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500 pointer-events-none" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {verified ? t.lockedEmailHint : t.accHint}
          </p>
        </div>
        <Button
          onClick={handleSaveProfile}
          disabled={saving}
          className="gap-2 rounded-[4px_20px_4px_20px]"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}{" "}
          {verified ? t.saveChanges : t.saveSendBtn}
        </Button>

        {/* Email verification — inline, code sent via Nodemailer on save */}
        <EmailVerification email={emailInput} sendSignal={sendSignal} />
      </div>

      {/* Stats */}
      <div className="px-5 sm:px-6 pt-5">
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
