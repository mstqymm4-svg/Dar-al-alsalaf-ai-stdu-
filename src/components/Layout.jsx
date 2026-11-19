import { Outlet, Link, useLocation } from "react-router-dom";
import { BookOpen, Home, Code, MessageCircle, User } from "lucide-react";
import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useT } from "@/lib/i18n";
import { getSetting, subscribeToSettings } from "@/lib/settingsStore";
import { getAccountEmail, getAvatarUrl } from "@/lib/activeUser";
import { NAV_ICONS, DEFAULT_NAV_ITEMS, readNavItems } from "@/lib/navConfig";

export default function Layout() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(() => getAvatarUrl(getAccountEmail(null)));
  const t = useT();

  const [showDevNav, setShowDevNav] = useState(() => getSetting("show_dev_nav") !== "false");
  const [logoUrl, setLogoUrl] = useState(() => getSetting("logo_url"));
  const [appNameOverride, setAppNameOverride] = useState(() => getSetting("app_name"));
  const [appSubtitleOverride, setAppSubtitleOverride] = useState(() => getSetting("app_subtitle"));
  const [navConfig, setNavConfig] = useState(() => readNavItems());

  useEffect(() => {
    const unsub = subscribeToSettings((s) => {
      setShowDevNav(s.show_dev_nav !== "false");
      setLogoUrl(s.logo_url || "");
      setAppNameOverride(s.app_name || "");
      setAppSubtitleOverride(s.app_subtitle || "");
      setNavConfig(readNavItems(s.nav_items));
    });
    const handler = () => setShowDevNav(getSetting("show_dev_nav") !== "false");
    const authSyncHandler = () => {
      const em = getAccountEmail(null);
      setAvatarUrl(getAvatarUrl(em));
    };
    window.addEventListener("storage", handler);
    window.addEventListener("dau-avatar-change", authSyncHandler);
    window.addEventListener("dau-email-change", authSyncHandler);
    window.addEventListener("dau-email-verified", authSyncHandler);
    return () => {
      unsub();
      window.removeEventListener("storage", handler);
      window.removeEventListener("dau-avatar-change", authSyncHandler);
      window.removeEventListener("dau-email-change", authSyncHandler);
      window.removeEventListener("dau-email-verified", authSyncHandler);
    };
  }, []);

  // Order, labels and visibility come from the developer panel (إدارة التنقل)
  // When a standard labelKey exists, we respect the current active language translation
  const navItems = [
    ...navConfig
      .filter((item) => item.visible !== false)
      .map((item) => {
        const defaultMatch = DEFAULT_NAV_ITEMS.find((d) => d.id === item.id);
        const isDefaultLabel = !item.label || (defaultMatch && defaultMatch.label === item.label);
        const label =
          (t.langCode !== "ar" && item.labelKey && t[item.labelKey])
            ? t[item.labelKey]
            : isDefaultLabel && item.labelKey && t[item.labelKey]
            ? t[item.labelKey]
            : (t[item.labelKey] || item.label || item.id);
        return {
          path: item.path,
          icon: NAV_ICONS[item.icon] || Home,
          label,
        };
      }),
    ...(showDevNav ? [{ path: "/dev", icon: Code, label: "Dev" }] : []),
  ];

  const cleanNameOverride = (appNameOverride ?? "").trim();
  const cleanSubOverride = (appSubtitleOverride ?? "").trim();
  const displayAppName =
    !cleanNameOverride || cleanNameOverride === "."
      ? ""
      : cleanNameOverride !== "المكتبة الدينية"
        ? cleanNameOverride
        : t.appName;
  const displayAppSubtitle =
    !cleanSubOverride || cleanSubOverride === "."
      ? ""
      : t.langCode === "ar" && cleanSubOverride !== "نور العلم والمعرفة"
        ? cleanSubOverride
        : t.appSubtitle;

  useEffect(() => {
    base44.auth.me().then((u) => {
      setUser(u);
      const em = getAccountEmail(u);
      if (em) setAvatarUrl(getAvatarUrl(em));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("dir", t.dir || "rtl");
    html.setAttribute("lang", t.langCode || "ar");
    if (t.fontFamily) {
      html.style.setProperty("--font-app", t.fontFamily);
      document.body.style.fontFamily = t.fontFamily;
    }
  }, [t.dir, t.langCode, t.fontFamily]);

  return (
    <div
      dir={t.dir}
      lang={t.langCode}
      className="min-h-screen min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden flex flex-col bg-background"
      style={{ fontFamily: t.fontFamily }}
    >
      {/* Top Header */}
      <header className="sticky top-0 z-50 bg-card/85 backdrop-blur-2xl border-b border-border safe-area-top shadow-sm shadow-black/5">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
            <Link to="/" className="flex items-center gap-2.5 sm:gap-3 group min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center overflow-hidden shrink-0 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-primary/30 transition-all">
                {logoUrl ?
                <img src={logoUrl} alt="logo" className="w-full h-full object-cover" /> :
                <BookOpen className="w-5 h-5 text-primary-foreground" />}
              </div>
              {(displayAppName || displayAppSubtitle) && (
                <div className="min-w-0">
                  {displayAppName && <h1 className="text-foreground text-base sm:text-xl font-bold leading-tight truncate">{displayAppName}</h1>}
                  {displayAppSubtitle && <p className="text-[10px] text-muted-foreground -mt-0.5 truncate">{displayAppSubtitle}</p>}
                </div>
              )}
            </Link>
            <nav className="hidden md:flex items-center gap-1 shrink-0">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative flex items-center gap-2 text-sm font-medium transition-all duration-200 pt-2 pr-3.5 pl-3.5 pb-2 rounded-[2px_16px_2px_16px] whitespace-nowrap ${
                    isActive ?
                    "bg-primary text-primary-foreground shadow-md shadow-primary/20" :
                    "text-muted-foreground hover:text-foreground hover:bg-muted"}`
                    }>
                    <item.icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>);
              })}
            </nav>
            <Link to="/settings" aria-label={t.navSettings} className="shrink-0 p-1.5 rounded-full hover:bg-muted transition-colors">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden bg-primary/10 border border-primary/20 flex items-center justify-center">
                {avatarUrl ?
                <img src={avatarUrl} alt={t.profile} className="w-full h-full object-cover" /> :
                <User className="w-4 h-4 text-primary" />}
              </div>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Bottom Nav — Mobile & Small Tablet Only */}
      <nav id="bottom-nav" className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-2xl border-t border-border shadow-lg shadow-black/5 transition-transform duration-300">
        <div className="flex items-center justify-around py-1 px-1 sm:px-2 safe-area-bottom">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 rounded-xl transition-all duration-200 ${
                isActive ? "text-primary font-bold" : "text-muted-foreground"}`
                }>
                <item.icon className={`w-5 h-5 shrink-0 transition-transform ${isActive ? "fill-primary/20 scale-110" : ""}`} />
                <span className="text-[10px] font-medium truncate max-w-full leading-tight">{item.label}</span>
              </Link>);
          })}
        </div>
      </nav>

      {/* Footer — Desktop Only */}
      <footer className="hidden md:block border-t border-border bg-card/50 mt-auto">
       <div className="max-w-7xl sm:px-6 lg:px-8 py-6 px-6">
         <div className="flex items-center justify-between">
           <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} {displayAppName}</p>
           <nav className="flex items-center gap-5">
             <Link to="/about" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">{t.aboutTitle} 


              </Link>
             <Link to="/contact" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
               <MessageCircle className="w-3.5 h-3.5" />
               {t.contactTitle}
             </Link>
           </nav>
         </div>
       </div>
      </footer>
      </div>);

}