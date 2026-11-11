import { motion } from "framer-motion";
import {
  BookOpen, Globe, Smartphone, Sparkles,
  Users, Languages, ShieldCheck, Library, WifiOff, Star, Download } from
"lucide-react";
import { useT } from "@/lib/i18n";
import { getSetting } from "@/lib/settingsStore";

export default function About() {
  const t = useT();
  const appName = getSetting("app_name") || t.appName || "دار العلوم";
  const appSubtitle = getSetting("app_subtitle") || t.appSubtitle;
  const logoUrl = getSetting("logo_url");

  const features = [
  { icon: BookOpen, title: t.feat1Title, desc: t.feat1Desc, color: "text-primary" },
  { icon: Globe, title: t.feat2Title, desc: t.feat2Desc, color: "text-accent" },
  { icon: Smartphone, title: t.feat3Title, desc: t.feat3Desc, color: "text-primary" },
  { icon: WifiOff, title: t.featOfflineTitle, desc: t.featOfflineDesc, color: "text-accent" },
  { icon: Languages, title: t.featLangsTitle, desc: t.featLangsDesc, color: "text-primary" },
  { icon: Download, title: t.featDownloadTitle, desc: t.featDownloadDesc, color: "text-accent" }];


  const stats = [
    { icon: Library, value: "+500", label: t.statBooks || "كتاب" },
    { icon: BookOpen, value: "+50", label: t.statVideos || "فيديو" },
    { icon: Globe, value: "6", label: t.statLangs || "لغات" },
  ];

  const values = [
    { icon: ShieldCheck, title: t.valueAuthenticity || "الأصالة", desc: t.valueAuthenticityDesc || "محتوى علمي شرعي موثوق على منهج أهل السنة والجماعة" },
    { icon: Star, title: t.valueQuality || "الجودة", desc: t.valueQualityDesc || "تجربة قراءة وتصفح متقدمة بتصميم مريح وعصري" },
    { icon: Users, title: t.valueAccess || "سهولة الوصول", desc: t.valueAccessDesc || "إتاحة مجانية للجميع مع دعم العمل دون اتصال بالإنترنت" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8" dir={t.dir || "rtl"}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-accent/10 p-8 sm:p-10 mb-8 shadow-sm">
          <div className="absolute top-4 left-6 text-6xl opacity-10 select-none">﷽</div>
          <div className="relative flex flex-col items-center text-center gap-4">
            {logoUrl && (
              <img src={logoUrl} alt={appName} className="w-20 h-20 object-contain rounded-2xl shadow-md" />
            )}
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary border border-primary/20">
              <Sparkles className="w-3.5 h-3.5" /> {t.aboutEyebrow || "مكتبة إسلامية رقمية مستقلة"}
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">{t.aboutTitle || "عن التطبيق"}</h1>
            {appSubtitle && <p className="text-sm sm:text-base text-muted-foreground max-w-xl">{appSubtitle}</p>}
          </div>
        </div>

        {/* Intro */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 space-y-4 mb-8">
          <p className="text-foreground leading-relaxed text-base sm:text-lg">
            {t.aboutP1?.replace("{appName}", appName) || `تطبيق ${appName} — دار العلوم المحمدية السلفية.`}
          </p>
          <p className="text-muted-foreground leading-relaxed">{t.aboutP2}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          {stats.map((s, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-4 text-center hover:border-primary/40 transition-colors">
              <s.icon className="w-6 h-6 text-primary mx-auto mb-1.5" />
              <p className="text-2xl font-black text-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Features */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-bold text-foreground">{t.aboutFeatures || "أبرز المزايا"}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/40 hover:shadow-sm transition-all">
                <f.icon className={`w-8 h-8 ${f.color} mb-3`} />
                <h3 className="font-bold text-sm text-foreground mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Values */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <h2 className="text-lg font-bold text-foreground">{t.aboutValues || "قيمنا ومبادئنا"}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {values.map((v, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-5 text-center hover:border-accent/40 transition-all">
                <v.icon className="w-8 h-8 text-accent mx-auto mb-3" />
                <h3 className="font-bold text-sm text-foreground mb-1">{v.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Contact CTA */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center space-y-3">
          <h3 className="font-bold text-base text-foreground">{t.contactTitle || "تواصل معنا"}</h3>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
            {t.contactIntro || "نسعد بتواصلكم معنا لأي استفسار أو اقتراح أو ملاحظة. تصل رسالتكم مباشرة إلى بريد تطبيق دار العلوم."}
          </p>
          <div className="pt-2">
            <a
              href="/contact"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs sm:text-sm shadow-sm hover:bg-primary/90 transition-colors"
            >
              {t.sendMessage || "إرسال رسالة الآن"}
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}