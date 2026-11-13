import { useState, useEffect } from "react";
import { MessageCircle, Save, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getSetting,
  setSetting,
  setSettings,
  subscribeToSettings,
  onSaveStatus,
  flushAllPendingSettings,
} from "@/lib/settingsStore";

const FIELDS = [
  { key: "contact_email", label: "البريد الإلكتروني للتواصل", placeholder: "support@example.com" },
  { key: "contact_phone", label: "رقم الهاتف", placeholder: "+966..." },
  { key: "contact_address", label: "العنوان", placeholder: "المدينة، الدولة" },
  { key: "whatsapp_url", label: "رابط واتساب", placeholder: "https://wa.me/..." },
  { key: "contact_telegram_url", label: "رابط تيليجرام", placeholder: "https://t.me/..." },
  { key: "contact_instagram_url", label: "رابط إنستغرام", placeholder: "https://instagram.com/..." },
];

const readFields = (src) =>
  Object.fromEntries(FIELDS.map((f) => [f.key, (src ? src[f.key] : getSetting(f.key)) || ""]));

export default function DevContactSettings() {
  const [values, setValues] = useState(() => readFields());
  const [status, setStatus] = useState("idle");
  const [showForm, setShowForm] = useState(() => getSetting("contact_show_form") !== "false");
  const [intro, setIntro] = useState(() => getSetting("contact_intro") || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubStatus = onSaveStatus((s) => setStatus(s));
    const unsubSettings = subscribeToSettings((s) => {
      setValues(readFields(s));
      setIntro(s.contact_intro || "");
      setShowForm(s.contact_show_form !== "false");
    });
    return () => {
      unsubStatus();
      unsubSettings();
    };
  }, []);

  const handleFieldChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSetting(key, value);
  };

  const handleIntroChange = (value) => {
    setIntro(value);
    setSetting("contact_intro", value);
  };

  const handleExplicitSave = async () => {
    setSaving(true);
    try {
      setSettings({
        ...values,
        contact_intro: intro,
        contact_show_form: String(showForm),
      });
      const res = await flushAllPendingSettings();
      if (res.ok) {
        toast.success("تم حفظ إعدادات التواصل ✓");
      } else {
        toast.error("تعذر الحفظ السحابي — تحقق من الاتصال");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-black">إدارة صفحة تواصل معنا</h2>
          <p className="text-xs text-muted-foreground">تحكم في قنوات التواصل والنموذج الظاهر للزوار</p>
        </div>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-2xl p-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="text-sm font-medium text-foreground mb-1.5 block">{f.label}</label>
            <Input
              value={values[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => handleFieldChange(f.key, e.target.value)}
              onBlur={() => flushAllPendingSettings().catch(() => {})}
              className="w-full"
            />
          </div>
        ))}

        <div>
          <label className="text-sm font-medium text-foreground mb-1.5 block">نص المقدمة</label>
          <Textarea
            value={intro}
            onChange={(e) => handleIntroChange(e.target.value)}
            onBlur={() => flushAllPendingSettings().catch(() => {})}
            rows={3}
            placeholder="نص يظهر تحت العنوان في صفحة التواصل"
            className="w-full resize-none"
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium">إظهار نموذج المراسلة</p>
            <p className="text-xs text-muted-foreground">عطّله إذا كنت تعتمد على القنوات فقط</p>
          </div>
          <Switch
            checked={showForm}
            onCheckedChange={(v) => {
              setShowForm(v);
              setSetting("contact_show_form", String(v));
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Save className="w-3.5 h-3.5" />
            <span>
              {status === "saving" ? "جارٍ الحفظ…" : status === "error" ? "تعذّر الحفظ — يرجى المحاولة" : "يُحفظ تلقائيًا"}
            </span>
          </div>
          <Button onClick={handleExplicitSave} disabled={saving} size="sm" className="rounded-xl gap-1.5 font-bold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            حفظ التغييرات
          </Button>
        </div>
      </div>
    </div>
  );
}