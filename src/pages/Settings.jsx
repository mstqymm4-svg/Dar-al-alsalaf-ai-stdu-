import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Bell, Moon, Sun, Globe, LogOut, Save, Languages, Info, Mail, ShieldCheck, AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MobileSelect } from "@/components/ui/mobile-select";
import SettingRow from "@/components/SettingRow";
import ProfileCard from "@/components/ProfileCard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import MobileHeader from "@/components/MobileHeader";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useT } from "@/lib/i18n";
import { bookLangLabel, BOOK_LANG_VALUES } from "@/lib/i18n-terms";
import { getAccountEmail } from "@/lib/activeUser";
import { setThemeMode, getThemeState, subscribeToTheme } from "@/lib/themeEngine";
import { PageSpinner } from "@/components/Skeleton";

const ls = {
  get: (k, fb = "") => {try {return localStorage.getItem(k) || fb;} catch (e) {return fb;}},
  set: (k, v) => {try {localStorage.setItem(k, v);} catch (e) {}}
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

  useEffect(() => {
    loadUser();
    const unsub = subscribeToTheme(({ isDark }) => setDarkMode(isDark));
    return unsub;
  }, []);

  const loadUser = async () => {
    const u = await base44.auth.me().catch(() => null);
    if (u) {
      setNotifications(u.notifications_enabled ?? true);
      setLanguage(u.preferred_language || "العربية");
      const em = getAccountEmail(u) || u.email;
      try { setVerified(!!em && localStorage.getItem(`email_verified_${em}`) === "1"); } catch (e) {}
    }
    setLoading(false);
  };

  const handleToggleDark = (val) => {
    setDarkMode(val);
    setThemeMode(val ? "dark" : "light");
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    await base44.auth.updateMe({ notifications_enabled: notifications, preferred_language: language });
    toast.success(t.savePreferences + " ✓");
    setSaving(false);
  };

  const handleSaveAppLang = () => {
    ls.set("dev_app_lang", appLang);
    window.dispatchEvent(new Event("app-lang-change"));
    toast.success(t.applyLang + " ✓");
  };

  // SDK logout clears the tokens and redirects to the server logout endpoint.
  // Safety net: if that redirect never starts, clear the session and reload.
  const handleLogout = () => {
    try {
      base44.auth.logout("/");
    } catch (e) {
      console.error("Logout failed:", e);
    }
    setTimeout(() => {
      try {
        localStorage.removeItem("base44_access_token");
        localStorage.removeItem("token");
      } catch (e) {}
      window.location.replace("/");
    }, 800);
  };

  const handleDeleteAccount = async () => {
    try {
      await base44.functions.invoke("deleteAccountRequest", {});
      toast.success(t.deleteRequestSent);
    } catch (e) {
      toast.error(t.deleteRequestFailed);
      return;
    }
    setTimeout(() => handleLogout(), 1200);
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <MobileHeader title={t.settings} />
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t.settings}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t.settingsSub}</p>
      </div>

      <div className="space-y-6">
        {/* Profile */}
        <ProfileCard />

        {/* Appearance */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sun className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-bold">{t.appearance}</h2>
          </div>
          <SettingRow
            title={t.darkMode}
            description={t.darkModeSub}
            control={
            <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <Switch checked={darkMode} onCheckedChange={handleToggleDark} />
                <Moon className="w-4 h-4 text-muted-foreground" />
              </div>
            } />
          
        </motion.div>

        {/* Preferences */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-bold">{t.preferences}</h2>
          </div>
          <div className="space-y-5">
            <SettingRow
              icon={<Bell className="w-4 h-4" />}
              title={t.notifications}
              description={t.notificationsSub}
              control={<Switch checked={notifications} onCheckedChange={setNotifications} />} />
            
            <div>
              <Label>{t.preferredLang}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">{t.preferredLangSub}</p>
              <MobileSelect
                value={language}
                onValueChange={setLanguage}
                placeholder={t.preferredLangPlaceholder}
                triggerClassName="mt-1.5"
                options={BOOK_LANG_VALUES.map((v) => ({ value: v, label: bookLangLabel(v, t.langCode) }))} />
              
            </div>
            <Button onClick={handleSavePreferences} disabled={saving} className="gap-2 rounded-[4px_20px_4px_20px]">
              <Save className="w-4 h-4" /> {t.savePreferences}
            </Button>
          </div>
        </motion.div>

        {/* App Language */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Languages className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold">{t.appLangTitle}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t.appLangSub}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
            { code: "ar", name: "العربية" },
            { code: "en", name: "English" },
            { code: "fr", name: "Français" },
            { code: "ur", name: "اردو" },
            { code: "hi", name: "हिंदी" },
            { code: "tr", name: "Türkçe" }].
            map(({ code, name }) =>
            <label key={code} className={`flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all ${appLang === code ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                <input type="radio" name="appLang" value={code} checked={appLang === code} onChange={() => setAppLang(code)} className="hidden" />
                <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${appLang === code ? "border-primary bg-primary" : "border-border"}`} />
                <span className="text-sm font-medium">{name}</span>
              </label>
            )}
          </div>
          <Button onClick={handleSaveAppLang} className="gap-2 w-full rounded-[4px_20px_4px_20px]">
            <Save className="w-4 h-4" /> {t.applyLang}
          </Button>
        </motion.div>

        {/* Security & Privacy */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.28 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <h2 className="text-base font-bold">{t.securityTitle}</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              {verified ?
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" /> :
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
              
              <p className={`text-sm font-medium ${verified ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                {verified ? t.securityVerified : t.securityUnverified}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground leading-relaxed">{t.securityPrivacySub}</p>
            </div>
          </div>
        </motion.div>

        {/* About & Contact */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Info className="w-4 h-4 text-primary" />
            </div>
            <h2 className="text-base font-bold">{t.aboutTitle} & {t.contactTitle}</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t.aboutContactSub}</p>
          <div className="grid grid-cols-2 gap-2">
            <Link to="/about" className="flex items-center justify-center gap-2 py-2.5 bg-primary/10 text-primary font-medium text-sm hover:bg-primary/15 transition-colors rounded-[4px_20px_4px_20px]">
              <Info className="w-4 h-4" /> {t.aboutTitle}
            </Link>
            <Link to="/contact" className="flex items-center justify-center gap-2 py-2.5 bg-primary/10 text-primary font-medium text-sm hover:bg-primary/15 transition-colors rounded-[4px_20px_4px_20px]">
              <Mail className="w-4 h-4" /> {t.contactTitle}
            </Link>
          </div>
        </motion.div>

        {/* Logout */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center">
              <LogOut className="w-4 h-4 text-destructive" />
            </div>
            <h2 className="text-base font-bold">{t.logout}</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t.logoutSub}</p>
          <Button variant="destructive" onClick={handleLogout} className="gap-2 rounded-[4px_20px_4px_20px]">
            <LogOut className="w-4 h-4" /> {t.logout}
          </Button>
        </motion.div>

        {/* Account Deletion — Play Store policy compliance */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }} className="bg-card border border-destructive/20 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-destructive" />
            </div>
            <h2 className="text-base font-bold">{t.deleteAccount}</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t.deleteAccountSub}</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="gap-2 rounded-[4px_20px_4px_20px]">
                <Trash2 className="w-4 h-4" /> {t.deleteAccount}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.deleteAccountConfirm}</AlertDialogTitle>
                <AlertDialogDescription>{t.deleteAccountWarning}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount}>{t.deletePermanently}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </motion.div>
      </div>
    </div>);

}