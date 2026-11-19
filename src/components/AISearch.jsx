import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";

// Normalize Arabic & multilingual strings for smart offline semantic/keyword matching
function normalizeSearchText(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // Remove tashkeel / harakat
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .trim();
}

const TOPIC_SYNONYMS = [
  ["صلاه", "الصلاه", "فقه", "عبادات", "طهاره", "وضوء", "اذان", "prayer", "salah", "namaz"],
  ["توحيد", "عقيده", "ايمان", "شرك", "اسماء", "صفات", "tawhid", "aqeedah", "creed"],
  ["قران", "تفسير", "تدبر", "ايات", "سور", "تجويد", "quran", "tafsir"],
  ["حديث", "سنه", "بخاري", "مسلم", "اربعين", "متون", "hadith", "sunnah"],
  ["سيره", "تاريخ", "نبي", "رسول", "صحابه", "غزوات", "seerah", "biography", "history"],
  ["تزكيه", "رقائق", "اخلاق", "اذكار", "دعاء", "قلوب", "اداب", "zikr", "dua"],
];

export function runOfflineSmartBookSearch(books, rawQuery) {
  const qNorm = normalizeSearchText(rawQuery);
  if (!qNorm) return [];

  const rawTokens = qNorm
    .split(/\s+/)
    .map((w) => w.replace(/^ال/, ""))
    .filter((w) => w.length >= 2);

  if (rawTokens.length === 0) {
    rawTokens.push(qNorm);
  }

  // Expand tokens with domain synonyms
  const expandedTokens = new Set(rawTokens);
  for (const token of rawTokens) {
    for (const group of TOPIC_SYNONYMS) {
      if (group.some((term) => term.includes(token) || token.includes(term))) {
        group.forEach((term) => expandedTokens.add(term.replace(/^ال/, "")));
      }
    }
  }

  const scored = [];
  for (const book of books || []) {
    const titleNorm = normalizeSearchText(book.title);
    const authorNorm = normalizeSearchText(book.author);
    const catNorm = normalizeSearchText(book.category);
    const descNorm = normalizeSearchText(book.description);
    const langNorm = normalizeSearchText(book.language);

    let score = 0;

    // Exact phrase match bonus
    if (titleNorm.includes(qNorm)) score += 12;
    if (catNorm.includes(qNorm)) score += 8;
    if (authorNorm.includes(qNorm)) score += 8;
    if (descNorm.includes(qNorm)) score += 5;

    // Direct token match
    for (const tok of rawTokens) {
      if (titleNorm.includes(tok)) score += 6;
      if (catNorm.includes(tok)) score += 5;
      if (authorNorm.includes(tok)) score += 4;
      if (descNorm.includes(tok)) score += 2;
      if (langNorm.includes(tok)) score += 2;
    }

    // Semantic synonym match
    for (const syn of expandedTokens) {
      if (rawTokens.includes(syn)) continue;
      if (titleNorm.includes(syn)) score += 2;
      if (catNorm.includes(syn)) score += 2.5;
      if (descNorm.includes(syn)) score += 1;
    }

    if (score > 0) {
      scored.push({ book, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.book);
}

export default function AISearch({ books, onResults, onClear }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setActive(true);

    // Offline-first fallback: if offline or if LLM fails, use instant local smart semantic search
    const fallbackToLocalSearch = () => {
      const matched = runOfflineSmartBookSearch(books, query);
      onResults(matched, `${t.aiResults || "نتائج البحث الذكي"}: "${query}"`);
      setLoading(false);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      fallbackToLocalSearch();
      return;
    }

    try {
      const booksList = books
        .map(
          (b, i) =>
            `${i + 1}. العنوان: "${b.title}" | المؤلف: ${b.author} | التصنيف: ${b.category} | ID: ${b.id}`
        )
        .join("\n");

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `أنت مساعد مكتبة إسلامية ذكي. المستخدم يبحث عن: "${query}"\n\nقائمة الكتب المتاحة:\n${booksList}\n\nمهمتك: ابحث في القائمة وأعد IDs الكتب المناسبة للبحث (كل ID في سطر). إذا لم يوجد شيء مناسب، أعد قائمة فارغة. أجب فقط بالـ IDs.`,
        response_json_schema: {
          type: "object",
          properties: {
            matching_ids: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
          },
        },
      });

      const ids =
        typeof result === "object" && result !== null ? result.matching_ids : [];
      const explanation =
        typeof result === "object" && result !== null ? result.explanation : "";
      const matchedBooks = books.filter((b) => ids?.includes(b.id));
      if (matchedBooks.length > 0) {
        onResults(matchedBooks, explanation || `${t.aiResults || "نتائج البحث عن"}: "${query}"`);
        setLoading(false);
      } else {
        fallbackToLocalSearch();
      }
    } catch {
      fallbackToLocalSearch();
    }
  };

  return (
    <div className="mb-4">
      {active && !loading && (
        <div className="flex items-center gap-1.5 mt-2">
          <Sparkles className="w-3 h-3 text-accent" />
          <span className="text-xs text-muted-foreground">{t.aiSearchActive}</span>
        </div>
      )}
    </div>
  );
}