import { useState, useEffect } from "react";
import { onSaveStatus, getSaveStatus } from "@/lib/settingsStore";
import { Loader2, AlertTriangle, Check } from "lucide-react";

export default function SaveStatusIndicator() {
  const [status, setStatus] = useState(() => getSaveStatus());

  useEffect(() => {
    const unsub = onSaveStatus(setStatus);
    return unsub;
  }, []);

  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <div
        dir="rtl"
        className="fixed bottom-20 md:bottom-5 left-4 z-[60] flex items-center gap-2 rounded-full bg-card/95 backdrop-blur border border-border px-3 py-1.5 text-xs font-medium text-foreground shadow-lg"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        <span>جارٍ الحفظ...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        dir="rtl"
        className="fixed bottom-20 md:bottom-5 left-4 z-[60] flex items-center gap-2 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-bold shadow-lg"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>تعذر الحفظ السحابي</span>
      </div>
    );
  }

  if (status === "saved") {
    return (
      <div
        dir="rtl"
        className="fixed bottom-20 md:bottom-5 left-4 z-[60] flex items-center gap-1.5 rounded-full bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium shadow-lg"
      >
        <Check className="w-3.5 h-3.5" />
        <span>تم الحفظ</span>
      </div>
    );
  }

  return null;
}