import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, BookOpen, Download } from "lucide-react";
import ProBookViewer from "@/components/probook/ProBookViewer";
import { useT } from "@/lib/i18n";
import { getBook } from "@/lib/offlineSync";
import PageLogoLoader from "@/components/PageLogoLoader";

export default function ReadBook() {
  const { id } = useParams();
  const t = useT();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBook();
  }, [id]);

  const loadBook = async () => {
    try {
      const b = await getBook(id);
      if (b) setBook(b);
    } catch {}
    setLoading(false);
  };

  // Hide the app's bottom nav while reading; restore it when leaving
  useEffect(() => {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
    };
  }, []);

  if (loading) {
    return <PageLogoLoader />;
  }

  if (!book || !book.pdf_url) {
    return (
      <div className="text-center py-20 px-4">
        <BookOpen className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="text-lg font-bold mb-2">{t.noPdf}</h3>
        <Link to="/books" className="text-primary text-sm hover:underline">
          {t.backToLib}
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed top-16 inset-x-0 bottom-0 z-40 flex flex-col bg-background">
      {/* Editorial Reader Header Bar */}
      <div className="bg-card/95 backdrop-blur border-b border-border px-3 sm:px-5 py-2 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/book/${book.id}`}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowRight className="w-4 h-4" />
            <span>{t.backBtn || "رجوع"}</span>
          </Link>

          <span className="text-border select-none" aria-hidden="true">
            /
          </span>

          <div className="flex items-center gap-2 min-w-0 text-xs">
            <span className="font-bold text-foreground truncate">{book.title}</span>
            {book.author && (
              <>
                <span className="text-muted-foreground hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="text-muted-foreground truncate hidden sm:inline">
                  {book.author}
                </span>
              </>
            )}
          </div>
        </div>

        <a
          href={book.pdf_url}
          download={`${book.title || "book"}.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap shrink-0"
          title="تنزيل ملف الكتاب PDF"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden xs:inline">تنزيل PDF</span>
        </a>
      </div>

      {/* Professional PDF Viewer */}
      <div className="flex-1 overflow-hidden relative">
        <ProBookViewer
          pdfUrl={book.pdf_url}
          title={book.title}
          bookId={book.id}
          language={t.langCode || "ar"}
        />
      </div>
    </div>
  );
}