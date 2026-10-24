import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Mail, MessageCircle, Send, Phone, MapPin, Instagram, CheckCircle2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { getSetting } from "@/lib/settingsStore";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import {
  initAuth,
  googleSignIn,
  getAccessToken,
  subscribeToGmailAuth,
  sendGmailMessage,
} from "@/lib/gmailService";

export default function Contact() {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(() => !!getAccessToken());
  const [gmailUserEmail, setGmailUserEmail] = useState("");
  const [confirmGmailOpen, setConfirmGmailOpen] = useState(false);
  const [sendingViaGmail, setSendingViaGmail] = useState(false);

  const contactEmail = getSetting("contact_email") || "mstqymm4@gmail.com";
  const whatsappUrl = getSetting("whatsapp_url") || "";
  const contactPhone = getSetting("contact_phone") || "";
  const contactAddress = getSetting("contact_address") || "";
  const contactIntro = getSetting("contact_intro") || t.contactIntro;
  const telegramUrl = getSetting("contact_telegram_url") || "";
  const instagramUrl = getSetting("contact_instagram_url") || "";
  const showForm = getSetting("contact_show_form") !== "false";

  useEffect(() => {
    initAuth(({ user, hasToken }) => {
      setGmailConnected(hasToken);
      setGmailUserEmail(user?.email || "");
      if (user?.email && !email) setEmail(user.email);
      if (user?.displayName && !name) setName(user.displayName);
    });
    const unsub = subscribeToGmailAuth(({ user, hasToken }) => {
      setGmailConnected(hasToken);
      setGmailUserEmail(user?.email || "");
    });
    return unsub;
  }, []);

  const handleConnectGoogle = async () => {
    try {
      const { user } = await googleSignIn();
      setGmailConnected(true);
      setGmailUserEmail(user?.email || "");
      if (user?.email && !email) setEmail(user.email);
      if (user?.displayName && !name) setName(user.displayName);
      toast.success("تم ربط حساب Gmail بنجاح");
    } catch (err) {
      if (err?.code !== "auth/popup-closed-by-user") {
        toast.error(err?.message || "تعذر تسجيل الدخول عبر Google");
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      toast.error(t.contactFillAll);
      return;
    }
    setSending(true);
    try {
      const { base44 } = await import("@/api/base44Client");
      await base44.functions.invoke("sendContactMessage", { name, email, message });
      toast.success(t.contactSent);
      setName("");setEmail("");setMessage("");
    } catch (err) {
      toast.error(t.contactSendError);
    } finally {
      setSending(false);
    }
  };

  const handleRequestGmailSend = () => {
    if (!message.trim()) {
      toast.error("يرجى كتابة نص الرسالة أولاً");
      return;
    }
    setConfirmGmailOpen(true);
  };

  const handleConfirmGmailSend = async () => {
    setConfirmGmailOpen(false);
    setSendingViaGmail(true);
    try {
      const subject = `رسالة تواصل من ${name.trim() || gmailUserEmail || "مستخدم دار العلوم"}`;
      const fullBody = `المرسل: ${name.trim() || "غير محدد"}\nالبريد: ${email.trim() || gmailUserEmail}\n\n${message.trim()}`;
      await sendGmailMessage({
        to: contactEmail,
        subject,
        body: fullBody,
      });
      toast.success("تم إرسال رسالتك مباشرة عبر Gmail بنجاح");
      setMessage("");
    } catch (err) {
      if (err.message === "NEEDS_AUTH") {
        setGmailConnected(false);
        toast.error("انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول بحساب Google");
      } else {
        toast.error(err.message || "فشل إرسال الرسالة عبر Gmail");
      }
    } finally {
      setSendingViaGmail(false);
    }
  };

  const channels = [
  { show: !!contactEmail, href: `mailto:${contactEmail}`, icon: Mail, color: "text-primary", bg: "bg-primary/10", label: t.contactEmailLabel, value: contactEmail },
  { show: !!whatsappUrl, href: whatsappUrl, icon: WhatsAppIcon, color: "text-green-600", bg: "bg-green-500/10", label: t.whatsappLabel, value: t.directContact, ext: true },
  { show: !!telegramUrl, href: telegramUrl, icon: Send, color: "text-sky-600", bg: "bg-sky-500/10", label: t.contactTelegram, value: t.contactDirectMsg, ext: true },
  { show: !!instagramUrl, href: instagramUrl, icon: Instagram, color: "text-pink-600", bg: "bg-pink-500/10", label: t.contactInstagram, value: t.contactFollowUs, ext: true },
  { show: !!contactPhone, href: `tel:${contactPhone}`, icon: Phone, color: "text-primary", bg: "bg-primary/10", label: t.contactPhone, value: contactPhone },
  { show: !!contactAddress, href: null, icon: MapPin, color: "text-primary", bg: "bg-primary/10", label: t.contactAddress, value: contactAddress }].
  filter((c) => c.show);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8" dir="rtl">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t.contactTitle}</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{contactIntro}</p>
            </div>
          </div>

          <Link to="/gmail">
            <Button variant="outline" size="sm" className="gap-1.5 rounded-xl text-xs">
              <Mail className="w-3.5 h-3.5 text-primary" />
              فتح مركز بريد Gmail
              <ExternalLink className="w-3 h-3" />
            </Button>
          </Link>
        </div>

        {/* Contact channels */}
        {channels.length > 0 &&
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
            {channels.map((c, i) => {
            const Inner =
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-card border border-border hover:border-primary/40 transition-colors h-full">
                  <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
                    <c.icon className={`w-5 h-5 ${c.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="text-sm font-medium text-foreground truncate">{c.value}</p>
                  </div>
                </div>;

            return c.href ?
            <a key={i} href={c.href} target={c.ext ? "_blank" : undefined} rel={c.ext ? "noopener noreferrer" : undefined}>{Inner}</a> :

            <div key={i}>{Inner}</div>;

          })}
          </div>
        }

        {/* Contact form */}
        {showForm &&
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t.contactName}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.contactNamePlaceholder} className="w-full" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">{t.contactEmailLabel}</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className="w-full" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">{t.contactMessage}</label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.contactMessagePlaceholder} rows={5} className="w-full resize-none" />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" disabled={sending} className="w-full sm:w-auto rounded-[4px_20px_4px_20px]">
                {sending ?
              <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    {t.sending}
                  </> :

              <>
                    <Send className="w-4 h-4" /> {t.sendMessage}
                  </>
              }
              </Button>

              {gmailConnected ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sendingViaGmail}
                  onClick={handleRequestGmailSend}
                  className="w-full sm:w-auto gap-2 rounded-[4px_20px_4px_20px]"
                >
                  <Mail className="w-4 h-4 text-primary" />
                  {sendingViaGmail ? "جاري الإرسال عبر Gmail..." : "إرسال مباشر عبر حساب Gmail"}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <GoogleSignInButton onClick={handleConnectGoogle} label="Sign in with Google" />
                </div>
              )}
            </div>

            {gmailConnected && gmailUserEmail && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>متصل بحساب Gmail: {gmailUserEmail}</span>
              </div>
            )}
          </form>
        }

        <AlertDialog open={confirmGmailOpen} onOpenChange={setConfirmGmailOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد إرسال الرسالة عبر Gmail</AlertDialogTitle>
              <AlertDialogDescription>
                سيتم إرسال هذه الرسالة من حسابك في Gmail ({gmailUserEmail}) إلى بريد الإدارة ({contactEmail}). هل ترغب في المتابعة؟
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmGmailSend}>
                تأكيد الإرسال
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </motion.div>
    </div>);
}