import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useT } from "@/lib/i18n";

const CODE_KEY = (email) => `ev_code_${email}`;
const VERIFIED_KEY = (email) => `email_verified_${email}`;
const EXPIRY_MS = 10 * 60 * 1000;
const RESEND_SECONDS = 60;

export default function EmailVerification({ email, sendSignal }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [verified, setVerified] = useState(() => {
    try {return localStorage.getItem(VERIFIED_KEY(email)) === "1";} catch {return false;}
  });

  // Reset state when the email changes
  useEffect(() => {
    if (!email) return;
    setVerified(() => {try {return localStorage.getItem(VERIFIED_KEY(email)) === "1";} catch {return false;}});
    setSent(false);
    setCode("");
    setCountdown(0);
  }, [email]);

  // Resend countdown ticker
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  // Send a fresh code whenever the parent signals (Save & Send button)
  const lastSignal = useRef(0);
  useEffect(() => {
    if (!sendSignal || !email || sendSignal === lastSignal.current) return;
    lastSignal.current = sendSignal;
    sendCode();
  }, [sendSignal]);  

  if (!email) return null;

  const sendCode = async () => {
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendVerificationCode", { email });
      const gen = String(res?.data?.code || "");
      if (!gen) throw new Error("no code returned");
      localStorage.setItem(CODE_KEY(email), JSON.stringify({ code: gen, exp: Date.now() + EXPIRY_MS }));
      setSent(true);
      setCountdown(RESEND_SECONDS);
      toast.success(t.evSentToast);
    } catch (e) {
      toast.error(t.evSendError);
    } finally {
      setSending(false);
    }
  };

  const verify = async (val = code) => {
    const v = String(val).trim();
    if (v.length !== 6) return;
    setVerifying(true);
    try {
      const raw = localStorage.getItem(CODE_KEY(email));
      if (!raw) {toast.error(t.evSendFirst);return;}
      const entry = JSON.parse(raw);
      if (Date.now() > entry.exp) {toast.error(t.evExpired);return;}
      if (entry.code !== v) {toast.error(t.evWrongCode);return;}
      localStorage.setItem(VERIFIED_KEY(email), "1");
      localStorage.removeItem(CODE_KEY(email));
      setVerified(true);
      setCode("");
      try {window.dispatchEvent(new Event("dau-email-verified"));} catch {}
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

  if (!sent) return null;

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <MailCheck className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold">{t.evCodePlaceholder}</p>
          <p className="text-xs text-muted-foreground truncate max-w-[220px]">{email}</p>
        </div>
      </div>

      <div dir="ltr" className="flex justify-center">
        <InputOTP maxLength={6} value={code} onChange={setCode} onComplete={(v) => verify(v)} disabled={verifying}>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) =>
            <InputOTPSlot key={i} index={i} className="h-11 w-10 text-lg font-bold" />
            )}
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        onClick={() => verify()}
        disabled={verifying || code.length !== 6}
        className="gap-2 w-full rounded-[4px_20px_4px_20px]">
        
        {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        {t.evVerify}
      </Button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <span>{t.evCheckSpam}</span>
        {countdown > 0 ?
        <span className="font-bold text-foreground/70">· {t.evResendIn.replace("{s}", countdown)}</span> :

        <button onClick={sendCode} disabled={sending} className="text-primary hover:underline font-bold">
            · {sending ? "…" : t.evResend}
          </button>
        }
      </div>
    </div>);

}