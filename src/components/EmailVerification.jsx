import { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Loader2,
  Mail,
  Send,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiBase";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "@/lib/i18n";

export default function EmailVerification({
  currentEmail = "",
  isVerified = false,
  onVerifiedSuccess,
  onCancel,
}) {
  const t = useT();
  const [email, setEmail] = useState(currentEmail || "");
  const [step, setStep] = useState("input"); // 'input' | 'otp' | 'success'
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [remainingAttempts, setRemainingAttempts] = useState(5);

  const otpInputsRef = useRef([]);

  useEffect(() => {
    if (currentEmail && !isVerified) {
      setEmail(currentEmail);
    }
  }, [currentEmail, isVerified]);

  // Resend countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Auto focus first OTP input when reaching 'otp' step
  useEffect(() => {
    if (step === "otp" && otpInputsRef.current[0]) {
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  // ───────────────────────────────────────────────────────────────────────────
  // Send OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const targetEmail = email.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMsg(t.pleaseEnterEmail || "يرجى إدخال البريد الإلكتروني");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      setErrorMsg(t.invalidEmail || "صيغة البريد الإلكتروني غير صحيحة");
      return;
    }

    setSending(true);
    try {
      const res = await fetch(apiUrl("/api/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errorText = data.error || t.sendFailed || "تعذر إرسال رمز التحقق، يرجى المحاولة لاحقاً.";
        setErrorMsg(errorText);
        toast.error(errorText);
        if (data.retryAfter) {
          setCountdown(data.retryAfter);
        }
        return;
      }

      toast.success(data.message || (t.resendSuccess || "تم إرسال رمز التحقق بنجاح"));
      setStep("otp");
      setCountdown(60);
      setOtp(["", "", "", "", "", ""]);
      setRemainingAttempts(5);
    } catch {
      setErrorMsg(t.serverConnError || "تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت.");
      toast.error(t.serverConnError || "تعذر الاتصال بالخادم");
    } finally {
      setSending(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Resend OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleResendOtp = async () => {
    if (countdown > 0 || sending) return;
    setErrorMsg("");
    setSending(true);

    try {
      const targetEmail = email.trim().toLowerCase();
      const res = await fetch(apiUrl("/api/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errorText = data.error || t.sendFailed || "تعذر إعادة إرسال الرمز";
        setErrorMsg(errorText);
        toast.error(errorText);
        if (data.retryAfter) {
          setCountdown(data.retryAfter);
        }
        return;
      }

      toast.success(t.resendSuccess || "تم إرسال رمز تحقق جديد بنجاح ✓");
      setCountdown(60);
      setOtp(["", "", "", "", "", ""]);
      setRemainingAttempts(5);
      if (otpInputsRef.current[0]) otpInputsRef.current[0].focus();
    } catch {
      toast.error(t.serverConnError || "فشل في إعادة إرسال الرمز");
    } finally {
      setSending(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // OTP Inputs handling
  // ───────────────────────────────────────────────────────────────────────────
  const handleDigitChange = (index, value) => {
    const cleaned = value.replace(/\D/g, "");
    const newOtp = [...otp];

    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, 6).split("");
      digits.forEach((d, i) => {
        newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(digits.length, 5);
      if (otpInputsRef.current[nextIndex]) {
        otpInputsRef.current[nextIndex].focus();
      }
      return;
    }

    newOtp[index] = cleaned;
    setOtp(newOtp);

    if (cleaned && index < 5 && otpInputsRef.current[index + 1]) {
      otpInputsRef.current[index + 1].focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0 && otpInputsRef.current[index - 1]) {
        otpInputsRef.current[index - 1].focus();
      }
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text/plain").trim();
    const digits = pastedData.replace(/\D/g, "").slice(0, 6).split("");

    if (digits.length > 0) {
      const newOtp = ["", "", "", "", "", ""];
      digits.forEach((d, i) => {
        newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(digits.length, 5);
      if (otpInputsRef.current[nextIndex]) {
        otpInputsRef.current[nextIndex].focus();
      }
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Verify OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const fullCode = otp.join("");
    if (fullCode.length !== 6) {
      setErrorMsg(t.enterAll6Digits || "يرجى إدخال جميع أرقام الرمز الستة");
      return;
    }

    const targetEmail = email.trim().toLowerCase();
    setVerifying(true);

    try {
      const res = await fetch(apiUrl("/api/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: targetEmail,
          otp: fullCode,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        const errorText = data.error || (t.evWrongCode || "رمز التحقق غير صحيح");
        setErrorMsg(errorText);
        toast.error(errorText);

        if (data.remainingAttempts !== undefined) {
          setRemainingAttempts(data.remainingAttempts);
        }
        if (errorText.includes("طلب رمز جديد")) {
          setOtp(["", "", "", "", "", ""]);
        }
        return;
      }

      setStep("success");
      toast.success(t.linkedSuccess || "تم التحقق من الرمز وربط البريد بنجاح ✓");

      // Notify parent to finalize linking
      if (onVerifiedSuccess) {
        onVerifiedSuccess(targetEmail);
      }
    } catch {
      setErrorMsg(t.serverConnError || "تعذر الاتصال بالخادم للتحقق من الرمز");
      toast.error(t.serverConnError || "تعذر الاتصال بالخادم");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.04] to-card p-4 sm:p-5 shadow-xs">
      <AnimatePresence mode="wait">
        {/* STEP 1: Enter Email to Send OTP */}
        {step === "input" && (
          <motion.div
            key="step-input"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {t.otpLinkTitle || "ربط البريد الإلكتروني برمز تحقق (OTP)"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.otpLinkDesc || "يتم ربط البريد وتفعيله بالحساب بعد التحقق من ملكيته"}
                  </p>
                </div>
              </div>

              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
                  title={t.cancel || "إلغاء"}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground block">
                {t.enterEmailToLink || "أدخل البريد المراد ربطه بالملف الشخصي"}
              </label>
              <div className="relative">
                <Mail className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="email"
                  dir="ltr"
                  placeholder="example@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                  className="pr-10 pl-9 h-10 rounded-xl bg-background border-border text-sm text-left font-mono"
                />
                {email && !sending && (
                  <button
                    type="button"
                    onClick={() => setEmail("")}
                    title={t.clearEmail || "مسح البريد"}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/80 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <Button
                type="button"
                onClick={handleSendOtp}
                disabled={sending || !email.trim()}
                className="gap-2 rounded-[4px_20px_4px_20px] font-bold text-xs h-10 flex-1"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.sendingOtp || "جاري إرسال الرمز..."}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>{t.sendOtpBtn || "إرسال رمز التحقق إلى البريد"}</span>
                  </>
                )}
              </Button>

              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={sending}
                  className="rounded-[4px_20px_4px_20px] text-xs h-10"
                >
                  {t.cancel || "إلغاء"}
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* STEP 2: Enter 6-digit OTP */}
        {step === "otp" && (
          <motion.div
            key="step-otp"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {t.enterOtp6Digits || "أدخل رمز التحقق (6 أرقام)"}
                  </h4>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                    <span>{t.otpSentTo || "أُرسل إلى:"}</span>
                    <span dir="ltr" className="font-mono font-bold text-foreground">
                      {email}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("input");
                        setErrorMsg("");
                      }}
                      className="text-primary hover:underline font-bold text-[11px] mr-1"
                    >
                      ({t.editEmail || "تعديل"})
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 6 Digits Boxes */}
            <div
              className="flex items-center justify-center gap-2 my-2"
              dir="ltr"
              onPaste={handlePaste}
            >
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (otpInputsRef.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(idx, e)}
                  disabled={verifying}
                  className="w-10 h-12 text-center text-xl font-bold rounded-xl border-2 border-border bg-background focus:border-primary focus:bg-primary/5 focus:outline-none transition-all"
                />
              ))}
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Timer and Resend */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <div>
                {countdown > 0 ? (
                  <span className="flex items-center gap-1">
                    <span>{t.resendAfter || "إعادة الإرسال بعد:"}</span>
                    <span className="font-mono font-bold text-primary">
                      {Math.floor(countdown / 60)}:
                      {(countdown % 60).toString().padStart(2, "0")}
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={sending}
                    className="text-primary font-bold hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sending ? "animate-spin" : ""}`} />
                    <span>{t.resendCode || "إعادة إرسال الرمز"}</span>
                  </button>
                )}
              </div>

              <span className="text-[11px] opacity-75">
                {(t.attemptsRemaining || "المحاولات المتاحة: {n} من 5").replace("{n}", remainingAttempts)}
              </span>
            </div>

            <Button
              type="button"
              onClick={handleVerifyOtp}
              disabled={verifying || otp.join("").length !== 6}
              className="w-full h-10 rounded-[4px_20px_4px_20px] font-bold text-xs gap-2"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.verifyingOtp || "جاري التحقق وربط البريد..."}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t.verifyAndLinkBtn || "تأكيد الرمز وربط البريد بالحساب"}</span>
                </>
              )}
            </Button>
          </motion.div>
        )}

        {/* STEP 3: Success Notification */}
        {step === "success" && (
          <motion.div
            key="step-success"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-2 space-y-2.5"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h4 className="text-base font-bold text-foreground">
              {t.otpSuccessTitle || "تم تأكيد البريد وربطه بنجاح!"}
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t.otpSuccessDesc || "تم توثيق بريدك الإلكتروني وربطه بملفك الشخصي بنجاح."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
