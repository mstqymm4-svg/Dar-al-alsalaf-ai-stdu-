import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  Mail,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { getAccountEmail, setAccountEmail } from "@/lib/activeUser";
import { useT } from "@/lib/i18n";
import { apiUrl } from "@/lib/apiBase";

function localizeOtpError(rawError, t, fallbackKey = "sendFailed") {
  const errStr = String(rawError || "");
  if (!errStr) return t[fallbackKey] || t.sendFailed;
  if (errStr.includes("الانتظار") || errStr.toLowerCase().includes("wait")) {
    return t.otpRateLimited || t[fallbackKey];
  }
  if (errStr.includes("انتهت صلاحية") || errStr.toLowerCase().includes("expired")) {
    return t.otpExpiredError || t.invalidOtp;
  }
  if (errStr.includes("تجاوزت الحد") || errStr.toLowerCase().includes("maximum")) {
    return t.otpMaxAttemptsError || t.invalidOtp;
  }
  if (errStr.includes("غير صحيح") || errStr.includes("لا يوجد رمز") || errStr.toLowerCase().includes("invalid")) {
    return t.invalidOtp;
  }
  if (errStr.includes("صيغة البريد")) {
    return t.invalidEmail;
  }
  return t.langCode === "ar" ? errStr : (t[fallbackKey] || t.sendFailed);
}

export default function VerifyEmail() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Steps: 'email' | 'otp' | 'success'
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [remainingAttempts, setRemainingAttempts] = useState(5);

  const otpInputsRef = useRef([]);

  // Auto-fill active user email on mount if available
  useEffect(() => {
    const queryEmail = searchParams.get("email");
    if (queryEmail && queryEmail.toLowerCase() !== "daraluloom258@gmail.com") {
      setEmail(queryEmail);
      return;
    }

    base44.auth
      .me()
      .then((u) => {
        const userEmail = (getAccountEmail(u) || u?.email || "").trim();
        if (userEmail && userEmail.toLowerCase() !== "daraluloom258@gmail.com") {
          setEmail(userEmail);
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // Resend countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Focus first OTP input when entering OTP step
  useEffect(() => {
    if (step === "otp" && otpInputsRef.current[0]) {
      otpInputsRef.current[0].focus();
    }
  }, [step]);

  const emailInputRef = useRef(null);

  // ───────────────────────────────────────────────────────────────────────────
  // Handle Send OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setErrorMsg(t.pleaseEnterEmail);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMsg(t.invalidEmail);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiUrl("/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorText = localizeOtpError(data.error, t, "sendFailed");
        setErrorMsg(errorText);
        toast.error(errorText);
        if (data.retryAfter) {
          setCountdown(data.retryAfter);
        }
        return;
      }

      toast.success(t.resendSuccess);
      setStep("otp");
      setCountdown(60); // 60 seconds cooldown
      setOtp(["", "", "", "", "", ""]);
      setRemainingAttempts(5);
    } catch {
      setErrorMsg(t.serverConnError);
      toast.error(t.serverConnError);
    } finally {
      setLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Handle Resend OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleResendOtp = async () => {
    if (countdown > 0 || resending) return;
    setErrorMsg("");
    setResending(true);

    try {
      const res = await fetch(apiUrl("/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorText = localizeOtpError(data.error, t, "sendFailed");
        setErrorMsg(errorText);
        toast.error(errorText);
        if (data.retryAfter) {
          setCountdown(data.retryAfter);
        }
        return;
      }

      toast.success(t.resendSuccess);
      setCountdown(60);
      setOtp(["", "", "", "", "", ""]);
      setRemainingAttempts(5);
      if (otpInputsRef.current[0]) otpInputsRef.current[0].focus();
    } catch {
      toast.error(t.serverConnError);
    } finally {
      setResending(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Handle OTP Digit Input & Pasting
  // ───────────────────────────────────────────────────────────────────────────
  const handleOtpChange = (index, value) => {
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
  // Handle Verify OTP
  // ───────────────────────────────────────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    setErrorMsg("");

    const fullCode = otp.join("");
    if (fullCode.length !== 6) {
      setErrorMsg(t.enterAll6Digits);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiUrl("/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: fullCode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorText = localizeOtpError(data.error, t, "invalidOtp");
        setErrorMsg(errorText);
        toast.error(errorText);

        if (data.remainingAttempts !== undefined) {
          setRemainingAttempts(data.remainingAttempts);
        }

        if (
          String(data.error || "").includes("طلب رمز جديد") ||
          (data.remainingAttempts !== undefined && data.remainingAttempts <= 0)
        ) {
          setOtp(["", "", "", "", "", ""]);
        }
        return;
      }

      const em = email.trim().toLowerCase();
      try {
        await base44.auth.signInWithVerifiedEmail(em);
      } catch {
        try {
          setAccountEmail(em);
          localStorage.setItem(`email_verified_${em}`, "1");
          window.dispatchEvent(new Event("dau-email-verified"));
          window.dispatchEvent(new Event("dau-email-change"));
        } catch {}
      }

      toast.success(t.linkedSuccess);
      setStep("success");
    } catch {
      setErrorMsg(t.serverConnError);
      toast.error(t.serverConnError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12" dir={t.dir}>
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md bg-card border border-border/80 rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden"
      >
        {/* Top Decorative Header */}
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
            <span>{t.backToSettings}</span>
          </Link>
        </div>

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* STEP 1: Login / Email Input                                         */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {step === "email" && (
            <motion.div
              key="step-email"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <LogIn className="w-7 h-7" />
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-foreground">
                  {t.loginTitle || t.verifyEmailTitle} — {t.brandName}
                </h1>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {t.loginSubtitle || t.verifyEmailSub}
                </p>
              </div>

              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground block">
                    {t.email}
                  </label>
                  <div className="relative group">
                    <Mail className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none" />
                    <Input
                      ref={emailInputRef}
                      type="email"
                      dir="ltr"
                      placeholder="name@gmail.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      required
                      className="pr-10 h-11 rounded-xl bg-background border-border text-sm focus-visible:border-primary text-left"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full h-11 rounded-[4px_20px_4px_20px] font-bold text-sm gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{t.sendingOtp}</span>
                    </>
                  ) : (
                    <>
                      <span>{t.sendOtpBtn}</span>
                      <ArrowLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
                    </>
                  )}
                </Button>
              </form>
            </motion.div>
          )}

          {/* ───────────────────────────────────────────────────────────────── */}
          {/* STEP 2: OTP Input (6 digits)                                      */}
          {/* ───────────────────────────────────────────────────────────────── */}
          {step === "otp" && (
            <motion.div
              key="step-otp"
              initial={{ opacity: 0, x: -15 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 15 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <h1 className="text-xl font-bold text-foreground">
                  {t.enterOtp6Digits}
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {t.otpSentTo}
                </p>
                <div className="inline-flex items-center gap-1.5 mt-1 px-3 py-1 rounded-lg bg-muted text-xs font-mono font-medium text-foreground">
                  <span dir="ltr">{email}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setErrorMsg("");
                    }}
                    className="text-primary hover:underline font-sans text-[11px] ms-1"
                  >
                    ({t.editEmail})
                  </button>
                </div>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-5">
                {/* 6 Digit Inputs */}
                <div
                  className="flex items-center justify-center gap-2 sm:gap-2.5 my-2"
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
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      disabled={loading}
                      className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-bold rounded-xl border-2 border-border bg-background focus:border-primary focus:bg-primary/5 focus:outline-none transition-all duration-200"
                    />
                  ))}
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Resend Timer & Counter */}
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <div>
                    {countdown > 0 ? (
                      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <span>{t.resendAfter}</span>
                        <span className="font-mono font-bold text-primary">
                          {Math.floor(countdown / 60)}:
                          {(countdown % 60).toString().padStart(2, "0")}
                        </span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={resending}
                        className="text-primary font-bold hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${resending ? "animate-spin" : ""}`} />
                        <span>{t.resendCode}</span>
                      </button>
                    )}
                  </div>

                  <span className="text-[11px] opacity-75">
                    {t.otpCodeValidity}
                  </span>
                </div>

                <Button
                  type="submit"
                  disabled={loading || otp.join("").length !== 6}
                  className="w-full h-11 rounded-[4px_20px_4px_20px] font-bold text-sm gap-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{t.verifyingOtp}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t.verifyCodeBtn}</span>
                    </>
                  )}
                </Button>
              </form>
            </motion.div>
          )}

          {/* ───────────────────────────────────────────────────────────────── */}
          {/* STEP 3: Success Screen                                            */}
          {/* ───────────────────────────────────────────────────────────────── */}
          {step === "success" && (
            <motion.div
              key="step-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="text-center py-4 space-y-4"
            >
              <div className="w-16 h-16 rounded-3xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {t.otpSuccessTitle}
                </h1>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t.otpSuccessDesc2}
                </p>
              </div>

              <div className="pt-2">
                <Button
                  onClick={() => navigate("/settings")}
                  className="w-full h-11 rounded-[4px_20px_4px_20px] font-bold text-sm gap-2"
                >
                  <span>{t.backToSettings}</span>
                  <ArrowLeft className="w-4 h-4 rtl:rotate-0 ltr:rotate-180" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

