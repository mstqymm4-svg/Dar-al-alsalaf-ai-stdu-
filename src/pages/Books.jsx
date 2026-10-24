import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search } from "lucide-react";
import AISearch from "../components/AISearch";
import BookCard from "../components/BookCard";
import { SkeletonGrid } from "../components/Skeleton";
import { Input } from "@/components/ui/input";
import { MobileSelect } from "@/components/ui/mobile-select";
import { useT } from "@/lib/i18n";
import { bookLangLabel } from "@/lib/i18n-terms";
import { getBooks, getFavoriteIds, toggleFavorite } from "@/lib/offlineSync";
import { getAccountEmail } from "@/lib/activeUser";
import { useContentRefresh } from "@/hooks/useContentSync";
import PullToRefresh from "@/components/PullToRefresh";
import { forceSyncNow } from "@/lib/contentSyncEngine";

export default function Books() {
  const t = useT();
  const [books, setBooks] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [activeCategory, setActiveCategory] = useState("الكل");
  const [user, setUser] = useState(null);
  const [preferredLanguage, setPreferredLanguage] = useState("الكل");
  const [aiResults, setAiResults] = useState(null);
  const [aiLabel, setAiLabel] = useState("");

  const urlParams = new URLSearchParams(window.location.search);
  const categoryParam = urlParams.get("category");

  useEffect(() => {
    if (categoryParam) setActiveCategory(categoryParam);
  }, [categoryParam]);

  const loadData = async () => {
    const u = await base44.auth.me().catch(() => null);
    setUser(u);
    const allBooks = await getBooks();
    setBooks(allBooks);
    if (u?.preferred_language && u.preferred_language !== 'الكل') {
      setPreferredLanguage(u.preferred_language);
    }
    if (u) {
      const favIds = await getFavoriteIds(getAccountEmail(u));
      setFavorites(favIds);
    }
    setLoading(false);
  };

  useEffect(() => {loadData();}, []);

  // Auto-refresh when books change in background
  useContentRefresh(["books"], loadData);

  const handleToggleFavorite = async (bookId) => {
    if (!user) return;
    const added = await toggleFavorite(bookId, getAccountEmail(user));
    setFavorites((prev) =>
    added ? [...prev, bookId] : prev.filter((id) => id !== bookId)
    );
  };

  const sortBooks = (list) => {
    const arr = [...list];
    if (sortBy === "title") arr.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ar"));
    else if (sortBy === "rating") arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sortBy === "oldest") arr.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
    else arr.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
    return arr;
  };

  const filteredBooks = aiResults ?? sortBooks(books.filter((book) => {
    const matchesCategory = activeCategory === "الكل" || book.category === activeCategory;
    const matchesSearch =
    !searchQuery ||
    book.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    book.author?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLanguage = preferredLanguage === "الكل" || !book.language || book.language === preferredLanguage;
    return matchesCategory && matchesSearch && matchesLanguage;
  }));

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SkeletonGrid count={10} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" />
      </div>);

  }

  return (
    <PullToRefresh onRefresh={async () => {await forceSyncNow();loadData();}}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">{t.library}</h1>
        <p className="text-sm text-muted-foreground">{t.librarySub}</p>
      </div>

      <AISearch
          books={books}
          onResults={(results, label) => {setAiResults(results);setAiLabel(label);}}
          onClear={() => {setAiResults(null);setAiLabel("");}} />
        

      <div className="relative mb-6 group">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 group-focus-within:text-primary transition-colors text-[hsl(var(--primary))]" />
        <Input
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-11 h-12 rounded-xl bg-card border-border text-sm focus-visible:border-primary focus-visible:ring-primary/20 transition-colors" />
          
      </div>

      {aiResults &&
        <div className="mb-4 px-4 py-2 rounded-xl bg-accent/10 border border-accent/30 text-sm text-foreground flex items-center gap-2">
          <span className="text-accent">✨</span> {aiLabel} — {aiResults.length} {t.booksCount}
        </div>
        }

      <div className="flex items-center justify-between mb-4 gap-2">
        <p className="text-sm text-muted-foreground shrink-0">{filteredBooks.length} {t.booksCount}</p>
        <div className="flex items-center gap-3 min-w-0">
          {preferredLanguage !== "الكل" &&
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{t.lang}: {bookLangLabel(preferredLanguage, t.langCode)}</span>
            <button onClick={() => setPreferredLanguage("الكل")} className="text-xs text-primary hover:underline">
              {t.showAll}
            </button>
          </div>
          }
          <MobileSelect
            value={sortBy}
            onValueChange={setSortBy}
            placeholder={t.sortBy}
            options={[
            { value: "newest", label: t.sortNewest },
            { value: "oldest", label: t.sortOldest },
            { value: "title", label: t.sortTitle },
            { value: "rating", label: t.sortRating }]} />

        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {filteredBooks.map((book, i) =>
          <BookCard key={book.id} book={book} index={i} isFavorite={favorites.includes(book.id)} onToggleFavorite={user ? handleToggleFavorite : null} />
          )}
      </div>

      {filteredBooks.length === 0 &&
        <div className="text-center py-20">
          <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="font-bold text-foreground mb-1">{t.noResults}</h3>
          <p className="text-sm text-muted-foreground">{t.noResultsSub}</p>
        </div>
        }
    </div>
    </PullToRefresh>);

}