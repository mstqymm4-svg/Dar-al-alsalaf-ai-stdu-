import { useState, useEffect } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { BookOpen, ShieldCheck } from "lucide-react";
import ProBookViewer from "@/components/probook/ProBookViewer";
import { useT } from "@/lib/i18n";
import { getBook } from "@/lib/offlineSync";
import PageLogoLoader from "@/components/PageLogoLoader";

export default function ReadBook() {
  const { id: paramId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = paramId || searchParams.get("id");
  const t = useT();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isWindowBlurred, setIsWindowBlurred] = useState(false);

  useEffect(() => {
    let active = true;
    const loadBook = async () => {
      setLoading(true);
      try {
        const b = await getBook(id);
        if (active && b) setBook(b);
      } catch {}
      if (active) setLoading(false);
    };
    loadBook();
    return () => {
      active = false;
    };
  }, [id]);

  // Hide the app's bottom nav while reading; restore it when leaving
  useEffect(() => {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
    };
  }, []);

  // Anti-screenshot & content protection
  useEffect(() => {
    const isTouchDevice =
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0);
    const handleBlur = () => {
      if (!isTouchDevice) setIsWindowBlurred(true);
    };
    const handleFocus = () => setIsWindowBlurred(false);
    const handleVisibility = () => {
      if (document.hidden) setIsWindowBlurred(true);
      else setIsWindowBlurred(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === "PrintScreen" || e.keyCode === 44) {
        setIsWindowBlurred(true);
        try {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText("");
          }
        } catch {}
        setTimeout(() => setIsWindowBlurred(false), 2000);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        e.stopPropagation();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        ["3", "4", "5"].includes(e.key)
      ) {
        setIsWindowBlurred(true);
        setTimeout(() => setIsWindowBlurred(false), 1500);
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  if (loading) {
    return <PageLogoLoader />;
  }

  if (!book) {
    return (
      <div className="text-center py-20 px-4">
        <BookOpen className="w-14 h-14 text-slate-400 mx-auto mb-4" />
        <h3 className="text-base font-bold mb-2">
          {t.noPdf || "لم يتم العثور على الكتاب المطلوب"}
        </h3>
        <Link
          to="/books"
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#155E75] text-white text-xs font-bold hover:bg-[#0891B2] transition-colors"
        >
          {t.backToLib || "العودة إلى المكتبة"}
        </Link>
      </div>
    );
  }

  return (
    <div
      data-book-reader
      className="fixed inset-0 z-50 flex flex-col bg-[#F8FAFC] dark:bg-[#0F172A] select-none"
      onPointerDown={() => {
        if (isWindowBlurred) setIsWindowBlurred(false);
      }}
      onTouchStart={() => {
        if (isWindowBlurred) setIsWindowBlurred(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <style>{`
        @media print {
          body, html, [data-book-reader], #root {
            display: none !important;
            visibility: hidden !important;
          }
        }
        [data-book-reader] {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
      `}</style>

      <div className="flex-1 overflow-hidden relative">
        <ProBookViewer
          book={book}
          pdfUrl={book.pdf_url || book.file_url || book.url}
          title={book.title}
          bookId={book.id}
          initialOutline={book.toc || book.table_of_contents}
          onBack={() => navigate(book?.id ? `/book/${book.id}` : "/books")}
          t={t}
        />

        {/* Privacy shield overlay when window is blurred/screenshot tool is opened */}
        {isWindowBlurred && (
          <div className="absolute inset-0 z-50 bg-[#F8FAFC]/95 dark:bg-[#0F172A]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center select-none pointer-events-none transition-opacity">
            <div className="w-12 h-12 rounded-2xl bg-[#155E75]/10 flex items-center justify-center mb-3">
              <ShieldCheck className="w-6 h-6 text-[#155E75] dark:text-[#A5F3FC]" />
            </div>
            <p className="text-sm font-bold text-[#0F172A] dark:text-[#F8FAFC] max-w-sm">
              {t.contentProtectedNotice || "المحتوى محمي داخل قارئ DAR AL TAWHID"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}