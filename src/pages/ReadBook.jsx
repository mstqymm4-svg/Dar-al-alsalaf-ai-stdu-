import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowRight, BookOpen } from "lucide-react";
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
    } catch (e) {}
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
    return (
      <PageLogoLoader />
    );
  }

  if (!book || !book.pdf_url) {
    return (
      <div className="text-center py-20 px-4">
        <BookOpen className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="text-lg font-bold mb-2">{t.noPdf}</h3>
        <Link to="/books" className="text-primary text-sm hover:underline">{t.backToLib}</Link>
      </div>
    );
  }

  return (
    <div className="fixed top-16 inset-x-0 bottom-0 z-40 flex flex-col bg-background">
      {/* Top Bar */}
      <div className="bg-card border-b border-border px-4 py-2 flex items-center justify-between gap-3 shrink-0">
        <Link to={`/book/${book.id}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowRight className="w-4 h-4" />
          <span className="hidden sm:inline">{book.title}</span>
          <span className="sm:hidden">{t.backBtn}</span>
        </Link>
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