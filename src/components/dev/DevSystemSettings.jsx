import { useState, useEffect } from "react";
import { Settings, RefreshCw, Trash2, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  DEFAULT_SETTINGS,
  getSetting,
  setSetting,
  setSettings,
  subscribeToSettings,
  flushAllPendingSettings,
} from "@/lib/settingsStore";

export default function DevSystemSettings() {
  const [showDevNav, setShowDevNav] = useState(() => getSetting("show_dev_nav") !== "false");
  const [appLang, setAppLang]       = useState(() => getSetting("app_lang") || "ar");
  const [saved, setSaved]           = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing]     = useState(false);

  useEffect(() => {
    const unsub = subscribeToSettings((s) => {
      setShowDevNav(s.show_dev_nav !== "false");
      setAppLang(s.app_lang || "ar");
    });
    return unsub;
  }, []);

  const handleSave = async () => {
    setSettings({ show_dev_nav: String(showDevNav), app_lang: appLang });
    const res = await flushAllPendingSettings();
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("تم حفظ الإعدادات ✓");
    } else {
      toast.error("تعذر الحفظ السحابي — تحقق من الاتصال");
    }
  };

  const handleReloadSave = async () => {
    setSettings({ show_dev_nav: String(showDevNav), app_lang: appLang });
    const res = await flushAllPendingSettings();
    if (!res.ok) {
      toast.error("تعذر حفظ الإعدادات سحابياً — تحقق من الاتصال");
      return;
    }
    toast.success("تم الحفظ — جاري إعادة التحميل...");
    setTimeout(() => window.location.reload(), 400);
  };

  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    try {
      setSettings({ ...DEFAULT_SETTINGS });
      await flushAllPendingSettings();
      try { localStorage.clear(); } catch(e) {}
      toast.success("تم المسح — جاري إعادة التحميل...");
      setTimeout(() => window.location.reload(), 600);
    } catch {
      toast.error("فشل مسح الإعدادات");
      setClearing(false);
    }
  };

  const handleResetTheme = async () => {
    setSettings({
      color_bg: "", color_fg: "", color_primary: "", color_secondary: "",
      color_accent: "", color_card: "", color_border: "", color_button: "",
      color_dark_bg: "", color_dark_fg: "", color_dark_primary: "", color_dark_secondary: "",
      color_dark_accent: "", color_dark_card: "", color_dark_border: "", color_dark_button: "",
    });
    const res = await flushAllPendingSettings();
    if (res.ok) toast.success("تم إعادة الألوان للافتراضي");
  };

  const handleResetFonts = async () => {
    setSettings({
      font_body: "", font_heading: "", font_title: "", font_nav: "", font_button: "",
      font_size: "16", line_height: "1.6", letter_spacing: "0", custom_fonts: "[]",
    });
    const res = await flushAllPendingSettings();
    if (res.ok) toast.success("تم إعادة الخطوط للافتراضي");
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* General */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-sm flex items-center gap-2"><Settings className="w-4 h-4 text-primary" /> إعدادات عامة</h3>

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
          <div>
            <Label className="text-sm font-bold">زر المطور في شريط التنقل</Label>
            <p className="text-xs text-muted-foreground mt-0.5">إظهار / إخفاء رابط اللوحة</p>
          </div>
          <Switch checked={showDevNav} onCheckedChange={v => { setShowDevNav(v); setSetting("show_dev_nav", String(v)); }} />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} className={`flex-1 rounded-xl h-11 font-bold gap-2 transition-all ${saved?"bg-green-600 hover:bg-green-700":""}`}>
            {saved ? <><Check className="w-4 h-4" />تم الحفظ!</> : <><Check className="w-4 h-4" />حفظ الإعدادات</>}
          </Button>
          <Button onClick={handleReloadSave} variant="outline" className="flex-1 rounded-xl h-11 font-bold gap-2">
            <RefreshCw className="w-4 h-4" /> حفظ وإعادة تحميل
          </Button>
        </div>
      </div>

      {/* Reset Sections */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-sm flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600" /> إعادة الضبط الجزئي</h3>
        <Button onClick={handleResetTheme} variant="outline" className="w-full rounded-xl h-11 gap-2 font-bold justify-start hover:border-amber-400/50 hover:text-amber-600">
          <RotateCcw className="w-4 h-4" /> إعادة ضبط الألوان والثيم
        </Button>
        <Button onClick={handleResetFonts} variant="outline" className="w-full rounded-xl h-11 gap-2 font-bold justify-start hover:border-amber-400/50 hover:text-amber-600">
          <RotateCcw className="w-4 h-4" /> إعادة ضبط الخطوط
        </Button>
      </div>

      {/* Danger Zone */}
      <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-5 space-y-3">
        <h3 className="font-bold text-sm text-destructive flex items-center gap-2">
          <Trash2 className="w-4 h-4" /> منطقة الخطر
        </h3>
        <p className="text-xs text-muted-foreground">مسح جميع إعدادات التخصيص المحفوظة وإعادة التطبيق إلى الحالة الافتراضية تماماً.</p>
        {confirmClear ? (
          <div className="flex gap-2">
            <Button onClick={handleClearAll} disabled={clearing} variant="destructive" className="flex-1 rounded-xl h-11 font-bold gap-2">
              <Trash2 className="w-4 h-4" /> {clearing ? "جاري المسح..." : "تأكيد المسح النهائي"}
            </Button>
            <Button onClick={() => setConfirmClear(false)} disabled={clearing} variant="outline" className="rounded-xl h-11 font-bold">
              إلغاء
            </Button>
          </div>
        ) : (
          <Button onClick={handleClearAll} variant="destructive" className="w-full rounded-xl h-11 font-bold gap-2">
            <Trash2 className="w-4 h-4" /> مسح جميع الإعدادات وإعادة التشغيل
          </Button>
        )}
      </div>

      {/* Version Info */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <h3 className="font-bold text-sm mb-3">معلومات النظام</h3>
        {[
          ["الإصدار", "Enterprise v2.0"],
          ["المنصة", "دار العلوم"],
          ["البيئة", "Production"],
          ["الإطار", "React 18 + Tailwind CSS"],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between py-1.5 border-b border-border last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-xs font-medium font-mono">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}