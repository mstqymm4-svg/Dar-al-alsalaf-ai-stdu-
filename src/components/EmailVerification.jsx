import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Loader2, MailCheck, Send, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

const CODE_KEY = (email) => `ev_code_${(email || "").trim().toLowerCase()}`;
const VERIFIED_KEY = (email) => `email_verified_${(email || "").trim()}`;
const EXPIRY_MS = 10 * 60 * 1000;
const RESEND_SECONDS = 60;

export default function EmailVerification({ email, sendSignal }) {
  const t = useT();
  const normalizedEmail = (email || "").trim();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(() => {
    if (!normalizedEmail) return false;
    try {
      const raw = localStorage.getItem(CODE_KEY(normalizedEmail));
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed && parsed.exp > Date.now());
    } catch {
      return false;
    }
  });
  const [countdown, setCountdown] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [verified, setVerified] = useState(() => {
    try {
      return Boolean(normalizedEmail && localStorage.getItem(VERIFIED_KEY(normalizedEmail)) === "1");
    } catch {
      return false;
    }
  });

  // Reset state when the email changes
  useEffect(() => {
    if (!normalizedEmail) return;
    setVerified(() => {
      try {
        return localStorage.getItem(VERIFIED_KEY(normalizedEmail)) === "1";
      } catch {
        return false;
      }
    });
    try {
      const raw = localStorage.getItem(CODE_KEY(normalizedEmail));
      const parsed = raw ? JSON.parse(raw) : null;
      setSent(Boolean(parsed && parsed.exp > Date.now()));
    } catch {
      setSent(false);
    }
    setCode("");
    setCountdown(0);
  }, [normalizedEmail]);

  // Resend countdown ticker
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  // Open confirmation modal whenever the parent signals (Save & Send button)
  const lastSignal = useRef(0);
  useEffect(() => {
    if (!sendSignal || sendSignal === lastSignal.current) return;
    lastSignal.current = sendSignal;
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return;
    setConfirmOpen(true);
  }, [sendSignal, normalizedEmail]);

  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) return null;

  const requestSendCode = () => {
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      toast.error(t.evInvalidEmail);
      return;
    }
    setConfirmOpen(true);
  };

  const executeSendCode = async (e) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (sending) return;
    const targetEmail = normalizedEmail;
    setSending(true);
    try {
      const gen = String(Math.floor(100000 + Math.random() * 900000));
      const res = await fetch("/api/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, code: gen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "تعذر إرسال بريد التحقق");
      }

      localStorage.setItem(
        CODE_KEY(targetEmail),
        JSON.stringify({ code: gen, exp: Date.now() + EXPIRY_MS })
      );
      setSent(true);
      setCountdown(RESEND_SECONDS);
      setConfirmOpen(false);
      toast.success(`${t.evSentToast} (${targetEmail})`);
    } catch (err) {
      toast.error(err?.message || t.evSendError);
    } finally {
      setSending(false);
    }
  };

  const verify = async (val = code) => {
    const v = String(val).trim();
    if (v.length !== 6) return;
    const targetEmail = normalizedEmail;
    setVerifying(true);
    try {
      const raw = localStorage.getItem(CODE_KEY(targetEmail));
      if (!raw) {
        toast.error(t.evSendFirst);
        return;
      }
      const entry = JSON.parse(raw);
      if (Date.now() > entry.exp) {
        toast.error(t.evExpired);
        return;
      }
      if (entry.code !== v) {
        toast.error(t.evWrongCode);
        return;
      }
      localStorage.setItem(VERIFIED_KEY(targetEmail), "1");
      if (email && email.trim() !== targetEmail) {
        localStorage.setItem(`email_verified_${email.trim()}`, "1");
      }
      localStorage.removeItem(CODE_KEY(targetEmail));
      setVerified(true);
      setCode("");
      try {
        window.dispatchEvent(new Event("dau-email-verified"));
      } catch {}
      toast.success(t.evSuccess);
    } catch {
      toast.error(t.evError);
    } finally {
      setVerifying(false);
    }
  };

  if (verified) {
    return null;
  }

  return (
    <>
      <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <MailCheck className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">
                {sent ? t.evCodePlaceholder : t.evTitle}
              </p>
              <p className="text-xs text-muted-foreground truncate max-w-[260px]" dir="ltr">
                {normalizedEmail}
              </p>
            </div>
          </div>

          {!sent && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={requestSendCode}
              disabled={sending}
              className="gap-1.5 rounded-xl text-xs"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 text-primary" />
              )}
              {t.evSend}
            </Button>
          )}
        </div>

        {sent && (
          <>
            <div dir="ltr" className="flex justify-center pt-1">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={setCode}
                onComplete={(v) => verify(v)}
                disabled={verifying}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-11 w-10 text-lg font-bold"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              type="button"
              onClick={() => verify()}
              disabled={verifying || code.length !== 6}
              className="gap-2 w-full rounded-[4px_20px_4px_20px]"
            >
              {verifying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              {t.evVerify}
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span>{t.evCheckSpam}</span>
              {countdown > 0 ? (
                <span className="font-bold text-foreground/70">
                  · {t.evResendIn.replace("{s}", countdown)}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={requestSendCode}
                  disabled={sending}
                  className="text-primary hover:underline font-bold"
                >
                  · {sending ? "…" : t.evResend}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              تأكيد إرسال رمز التحقق
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right leading-relaxed text-sm text-muted-foreground">
                <p>
                  سيتم إرسال رمز تحقق مكوّن من 6 أرقام إلى البريد الإلكتروني:{" "}
                  <strong className="text-foreground" dir="ltr">
                    {normalizedEmail}
                  </strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  يُرجى التحقق من البريد الإلكتروني المدخل وإدخال الرمز لتأكيد ربطه بالملف الشخصي.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={sending}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeSendCode}
              disabled={sending}
              className="gap-1.5"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {sending ? "جاري الإرسال..." : "تأكيد وإرسال الرمز"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
