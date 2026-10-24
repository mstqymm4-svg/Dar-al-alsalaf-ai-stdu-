import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  Send,
  Inbox,
  Star,
  Trash2,
  FileText,
  RefreshCw,
  Search,
  Plus,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Reply,
  MailOpen,
  BookOpen,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import GoogleSignInButton from "@/components/GoogleSignInButton";
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  subscribeToGmailAuth,
  fetchGmailProfile,
  fetchGmailMessages,
  fetchGmailLabels,
  sendGmailMessage,
  createGmailDraft,
  trashGmailMessage,
  deleteGmailMessagePermanently,
  modifyGmailMessageLabels,
} from "@/lib/gmailService";
import { getBooks } from "@/lib/offlineSync";

const FOLDERS = [
  { id: "INBOX", label: "البريد الوارد", icon: Inbox },
  { id: "SENT", label: "المرسل", icon: Send },
  { id: "STARRED", label: "المميز بنجمة", icon: Star },
  { id: "DRAFT", label: "المسودات", icon: FileText },
  { id: "TRASH", label: "المهملات", icon: Trash2 },
];

export default function GmailClient({ compact = false }) {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeFolder, setActiveFolder] = useState("INBOX");
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [labels, setLabels] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [books, setBooks] = useState([]);

  // Confirmation modal state for all mutating/destructive operations
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    description: "",
    actionLabel: "تأكيد",
    variant: "default",
    onConfirm: null,
  });
  const [executingAction, setExecutingAction] = useState(false);

  const loadMailboxData = useCallback(
    async (folder = activeFolder, query = searchQuery) => {
      const token = await getAccessToken();
      if (!token) {
        setNeedsAuth(true);
        return;
      }
      setLoadingMessages(true);
      try {
        const [prof, msgs, lbls] = await Promise.all([
          fetchGmailProfile().catch(() => null),
          fetchGmailMessages({
            maxResults: compact ? 8 : 15,
            q: query,
            labelIds: folder ? [folder] : [],
          }),
          fetchGmailLabels().catch(() => []),
        ]);
        if (prof) setProfile(prof);
        setMessages(msgs || []);
        setLabels(lbls || []);
        if (selectedMessage) {
          const updated = (msgs || []).find((m) => m.id === selectedMessage.id);
          setSelectedMessage(updated || null);
        }
      } catch (err) {
        if (err?.code === "AUTH_REQUIRED") {
          setNeedsAuth(true);
        } else {
          toast.error(err?.message || "تعذر تحميل رسائل Gmail");
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    [activeFolder, searchQuery, compact, selectedMessage]
  );

  useEffect(() => {
    const unsubAuth = initAuth(
      (u) => {
        setUser(u);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setProfile(null);
        setMessages([]);
      }
    );
    const unsubStore = subscribeToGmailAuth(({ user: u, isAuthenticated }) => {
      setUser(u);
      setNeedsAuth(!isAuthenticated);
    });
    getBooks()
      .then((b) => setBooks(b || []))
      .catch(() => {});

    return () => {
      if (typeof unsubAuth === "function") unsubAuth();
      if (typeof unsubStore === "function") unsubStore();
    };
  }, []);

  useEffect(() => {
    if (!needsAuth) {
      loadMailboxData(activeFolder, searchQuery);
    }
  }, [needsAuth, activeFolder]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
        toast.success(`تم تسجيل الدخول بنجاح (${result.user.email})`);
      }
    } catch (err) {
      console.error("Login failed:", err);
      toast.error(err?.message || "فشل تسجيل الدخول عبر Google");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setNeedsAuth(true);
    setUser(null);
    setProfile(null);
    setMessages([]);
    setSelectedMessage(null);
    toast.success("تم تسجيل الخروج من Gmail");
  };

  const requestConfirmation = ({ title, description, actionLabel, variant = "default", onConfirm }) => {
    setConfirmDialog({
      open: true,
      title,
      description,
      actionLabel,
      variant,
      onConfirm,
    });
  };

  const handleExecuteConfirmed = async () => {
    if (!confirmDialog.onConfirm) return;
    setExecutingAction(true);
    try {
      await confirmDialog.onConfirm();
    } finally {
      setExecutingAction(false);
      setConfirmDialog((prev) => ({ ...prev, open: false, onConfirm: null }));
    }
  };

  const handleSendEmailRequest = (e) => {
    e.preventDefault();
    if (!composeTo.trim() || !composeSubject.trim() || !composeBody.trim()) {
      toast.error("يرجى تعبئة المستلم والموضوع ونص الرسالة");
      return;
    }

    requestConfirmation({
      title: "تأكيد إرسال البريد الإلكتروني",
      description: `هل أنت متأكد من إرسال هذه الرسالة عبر حسابك في Gmail إلى "${composeTo.trim()}" بعنوان "${composeSubject.trim()}"؟`,
      actionLabel: "إرسال الآن",
      variant: "default",
      onConfirm: async () => {
        const token = await getAccessToken();
        if (!token) {
          setNeedsAuth(true);
          return;
        }
        try {
          await sendGmailMessage({
            to: composeTo.trim(),
            cc: composeCc.trim() || undefined,
            subject: composeSubject.trim(),
            body: composeBody,
          });
          toast.success("تم إرسال البريد الإلكتروني بنجاح عبر Gmail");
          setComposeTo("");
          setComposeCc("");
          setComposeSubject("");
          setComposeBody("");
          setShowCompose(false);
          loadMailboxData(activeFolder, searchQuery);
        } catch (err) {
          if (err?.code === "AUTH_REQUIRED") setNeedsAuth(true);
          toast.error(err?.message || "فشل إرسال البريد الإلكتروني");
        }
      },
    });
  };

  const handleSaveDraftRequest = () => {
    if (!composeTo.trim() && !composeSubject.trim() && !composeBody.trim()) {
      toast.error("أدخل بيانات المسودة أولاً");
      return;
    }

    requestConfirmation({
      title: "تأكيد حفظ المسودة في Gmail",
      description: `سيتم حفظ مسودة رسالة جديدة في حسابك على Gmail بعنوان "${composeSubject.trim() || "(بدون عنوان)"}". هل ترغب بالمتابعة؟`,
      actionLabel: "حفظ المسودة",
      variant: "default",
      onConfirm: async () => {
        try {
          await createGmailDraft({
            to: composeTo.trim(),
            cc: composeCc.trim() || undefined,
            subject: composeSubject.trim(),
            body: composeBody,
          });
          toast.success("تم حفظ المسودة في Gmail بنجاح");
          setShowCompose(false);
          if (activeFolder === "DRAFT") loadMailboxData("DRAFT", searchQuery);
        } catch (err) {
          if (err?.code === "AUTH_REQUIRED") setNeedsAuth(true);
          toast.error(err?.message || "تعذر حفظ المسودة");
        }
      },
    });
  };

  const handleTrashMessageRequest = (msg) => {
    requestConfirmation({
      title: "نقل الرسالة إلى المهملات؟",
      description: `هل أنت متأكد من نقل الرسالة "${msg.subject}" من (${msg.from}) إلى سلة المهملات في Gmail؟`,
      actionLabel: "نقل إلى المهملات",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await trashGmailMessage(msg.id);
          toast.success("تم نقل الرسالة إلى المهملات");
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          if (selectedMessage?.id === msg.id) setSelectedMessage(null);
        } catch (err) {
          if (err?.code === "AUTH_REQUIRED") setNeedsAuth(true);
          toast.error(err?.message || "تعذر نقل الرسالة إلى المهملات");
        }
      },
    });
  };

  const handlePermanentDeleteRequest = (msg) => {
    requestConfirmation({
      title: "حذف الرسالة نهائياً من Gmail؟",
      description: `تحذير: سيتم حذف الرسالة "${msg.subject}" نهائياً من بريدك الإلكتروني ولا يمكن التراجع عن هذا الإجراء.`,
      actionLabel: "حذف نهائي",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await deleteGmailMessagePermanently(msg.id);
          toast.success("تم حذف الرسالة نهائياً");
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
          if (selectedMessage?.id === msg.id) setSelectedMessage(null);
        } catch (err) {
          if (err?.code === "AUTH_REQUIRED") setNeedsAuth(true);
          toast.error(err?.message || "تعذر حذف الرسالة نهائياً");
        }
      },
    });
  };

  const handleToggleStarRequest = (msg) => {
    const willStar = !msg.isStarred;
    requestConfirmation({
      title: willStar ? "تمييز الرسالة بنجمة؟" : "إزالة النجمة عن الرسالة؟",
      description: `سيتم ${willStar ? "إضافة نجمة إلى" : "إزالة النجمة من"} الرسالة "${msg.subject}" في حساب Gmail الخاص بك.`,
      actionLabel: "تأكيد التحديث",
      variant: "default",
      onConfirm: async () => {
        try {
          await modifyGmailMessageLabels(msg.id, {
            addLabelIds: willStar ? ["STARRED"] : [],
            removeLabelIds: willStar ? [] : ["STARRED"],
          });
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, isStarred: willStar } : m))
          );
          if (selectedMessage?.id === msg.id) {
            setSelectedMessage((prev) => (prev ? { ...prev, isStarred: willStar } : null));
          }
          toast.success(willStar ? "تم تمييز الرسالة بنجمة" : "تمت إزالة النجمة");
        } catch (err) {
          if (err?.code === "AUTH_REQUIRED") setNeedsAuth(true);
          toast.error(err?.message || "تعذر تحديث حالة النجمة");
        }
      },
    });
  };

  const handleReply = (msg) => {
    const replyToMatch = msg.from.match(/<([^>]+)>/);
    const replyAddress = replyToMatch ? replyToMatch[1] : msg.from;
    setComposeTo(replyAddress);
    setComposeSubject(
      msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`
    );
    setComposeBody(
      `\n\n---\nفي ${msg.date}، كتب ${msg.from}:\n> ${(msg.bodyText || msg.snippet || "").replace(/\n/g, "\n> ")}`
    );
    setShowCompose(true);
  };

  const applyBookShareTemplate = (book) => {
    if (!book) return;
    setComposeSubject(`توصية كتاب من مكتبة دار العلوم: ${book.title}`);
    setComposeBody(
      `السلام عليكم ورحمة الله وبركاته،\n\nأشارككم هذا الكتاب القيّم من مكتبة دار العلوم الإسلامية:\n\n` +
        `📖 العنوان: ${book.title}\n` +
        `✍️ المؤلف: ${book.author || "غير محدد"}\n` +
        `📂 التصنيف: ${book.category || "عام"}\n` +
        (book.description ? `📝 نبذة: ${book.description}\n` : "") +
        (book.pdf_url ? `\n🔗 رابط قراءة وتحميل الكتاب:\n${book.pdf_url}\n` : "") +
        `\nمع أطيب التحيات،\nمكتبة دار العلوم`
    );
    setShowCompose(true);
  };

  if (needsAuth) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 text-center space-y-5" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
          <Mail className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          <h2 className="text-xl font-bold text-foreground">ربط خدمة البريد الإلكتروني Gmail</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            قم بتسجيل الدخول باستخدام حساب Google الخاص بك لتصفح رسائل البريد الإلكتروني، إرسال الرسائل والتوصيات العلمية، وإدارة المسودات والتصنيفات مباشرة من داخل تطبيق دار العلوم.
          </p>
        </div>
        <div className="flex justify-center pt-2">
          <GoogleSignInButton
            onClick={handleLogin}
            disabled={isLoggingIn}
            label={isLoggingIn ? "Signing in..." : "Sign in with Google"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Top Connected Account Bar */}
      <div className="bg-card border border-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground truncate">
                {user?.displayName || "حساب Gmail متصل"}
              </p>
              <Badge variant="secondary" className="text-[10px]">
                متصل بـ Gmail
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {profile?.emailAddress || user?.email}
              {profile?.messagesTotal !== undefined && ` · ${profile.messagesTotal} رسالة`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowCompose(!showCompose)}
            className="gap-1.5 rounded-xl"
          >
            <Plus className="w-4 h-4" />
            <span>رسالة جديدة</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadMailboxData(activeFolder, searchQuery)}
            disabled={loadingMessages}
            className="gap-1.5 rounded-xl"
          >
            <RefreshCw className={`w-4 h-4 ${loadingMessages ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">تحديث</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleLogout}
            className="gap-1.5 text-destructive hover:text-destructive rounded-xl"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">خروج</span>
          </Button>
        </div>
      </div>

      {/* Compose Panel */}
      {showCompose && (
        <form
          onSubmit={handleSendEmailRequest}
          className="bg-card border-2 border-primary/25 rounded-2xl p-5 space-y-4 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-base">إنشاء رسالة بريد إلكتروني جديدة</h3>
            </div>
            {books.length > 0 && (
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-primary" />
                <select
                  onChange={(e) => {
                    const bk = books.find((b) => b.id === e.target.value);
                    if (bk) applyBookShareTemplate(bk);
                  }}
                  defaultValue=""
                  className="text-xs bg-muted border border-border rounded-lg px-2 py-1 min-h-0 h-8"
                >
                  <option value="" disabled>
                    إدراج توصية كتاب...
                  </option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                إلى (المستلم) *
              </label>
              <Input
                type="email"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="recipient@example.com"
                dir="ltr"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                نسخة (Cc) اختياري
              </label>
              <Input
                type="text"
                value={composeCc}
                onChange={(e) => setComposeCc(e.target.value)}
                placeholder="cc@example.com"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              الموضوع *
            </label>
            <Input
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              placeholder="عنوان الرسالة"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              نص الرسالة *
            </label>
            <Textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={5}
              placeholder="اكتب رسالتك هنا..."
              required
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-2">
              <Button type="submit" className="gap-1.5 rounded-xl">
                <Send className="w-4 h-4" />
                <span>إرسال عبر Gmail</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveDraftRequest}
                className="gap-1.5 rounded-xl"
              >
                <FileText className="w-4 h-4" />
                <span>حفظ كمسودة</span>
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCompose(false)}
              className="rounded-xl"
            >
              إلغاء
            </Button>
          </div>
        </form>
      )}

      {/* Search & Folder Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {FOLDERS.map((f) => {
            const active = activeFolder === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setActiveFolder(f.id);
                  setSelectedMessage(null);
                }}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadMailboxData(activeFolder, searchQuery);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1 sm:w-60">
            <Search className="w-4 h-4 text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث في رسائل Gmail..."
              className="pr-9 h-9 text-xs"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" className="h-9 rounded-xl">
            بحث
          </Button>
        </form>
      </div>

      {/* Labels Summary Pill Bar */}
      {!compact && labels.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-hide">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0 ml-2">
            <Tag className="w-3 h-3" /> التصنيفات المتاحة:
          </span>
          {labels.slice(0, 10).map((lbl) => (
            <span
              key={lbl.id}
              className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0"
            >
              {lbl.name}
            </span>
          ))}
        </div>
      )}

      {/* Messages Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Message List */}
        <div
          className={`${
            selectedMessage ? "lg:col-span-5" : "lg:col-span-12"
          } bg-card border border-border rounded-2xl overflow-hidden`}
        >
          {loadingMessages ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">جاري جلب الرسائل من Gmail...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <MailOpen className="w-8 h-8 text-muted-foreground/50 mx-auto" />
              <p className="text-sm font-medium text-foreground">لا توجد رسائل في هذا القسم</p>
              <p className="text-xs text-muted-foreground">
                جرب البحث بكلمات أخرى أو إنشاء رسالة جديدة
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[540px] overflow-y-auto">
              {messages.map((msg) => {
                const isSelected = selectedMessage?.id === msg.id;
                return (
                  <div
                    key={msg.id}
                    onClick={() => setSelectedMessage(msg)}
                    className={`p-4 cursor-pointer transition-colors hover:bg-muted/60 flex items-start justify-between gap-3 ${
                      isSelected ? "bg-primary/10" : msg.isUnread ? "bg-primary/[0.03]" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        {msg.isUnread && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                        <p
                          className={`text-sm truncate ${
                            msg.isUnread ? "font-bold text-foreground" : "font-medium text-foreground/90"
                          }`}
                        >
                          {msg.subject}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{msg.from}</p>
                      <p className="text-xs text-muted-foreground/80 line-clamp-1">
                        {msg.snippet}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleStarRequest(msg);
                          }}
                          title="تمييز بنجمة"
                          className="p-1 rounded-lg hover:bg-muted"
                        >
                          <Star
                            className={`w-4 h-4 ${
                              msg.isStarred
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTrashMessageRequest(msg);
                          }}
                          title="نقل إلى المهملات"
                          className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Message Detail Reader */}
        {selectedMessage && (
          <div className="lg:col-span-7 bg-card border border-border rounded-2xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground break-words">
                    {selectedMessage.subject}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    من: <span className="font-medium text-foreground">{selectedMessage.from}</span>
                  </p>
                  {selectedMessage.to && (
                    <p className="text-xs text-muted-foreground">
                      إلى: <span>{selectedMessage.to}</span>
                    </p>
                  )}
                  {selectedMessage.date && (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5" dir="ltr">
                      {selectedMessage.date}
                    </p>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedMessage(null)}
                  className="text-xs shrink-0"
                >
                  إغلاق
                </Button>
              </div>

              <div className="bg-muted/40 border border-border/60 rounded-xl p-4 max-h-[340px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap break-words">
                {selectedMessage.bodyText || selectedMessage.snippet || "لا يوجد محتوى نصي"}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleReply(selectedMessage)}
                  className="gap-1.5 rounded-xl"
                >
                  <Reply className="w-4 h-4" />
                  <span>رد على الرسالة</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleToggleStarRequest(selectedMessage)}
                  className="gap-1.5 rounded-xl"
                >
                  <Star
                    className={`w-4 h-4 ${
                      selectedMessage.isStarred ? "fill-amber-400 text-amber-400" : ""
                    }`}
                  />
                  <span>{selectedMessage.isStarred ? "إزالة النجمة" : "تمييز بنجمة"}</span>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {!selectedMessage.isTrash ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleTrashMessageRequest(selectedMessage)}
                    className="gap-1.5 rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>نقل للمهملات</span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handlePermanentDeleteRequest(selectedMessage)}
                    className="gap-1.5 rounded-xl"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span>حذف نهائي</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Explicit User Confirmation Dialog for all mutating/destructive operations */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!executingAction) {
            setConfirmDialog((prev) => ({ ...prev, open }));
          }
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={executingAction}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleExecuteConfirmed();
              }}
              disabled={executingAction}
              className={
                confirmDialog.variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
            >
              {executingAction ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                confirmDialog.actionLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
