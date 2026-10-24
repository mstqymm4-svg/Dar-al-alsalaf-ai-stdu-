import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookOpen, X, Search, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

/** Side panel showing the PDF outline (table of contents). */
export function TocPanel({ show, isRTL, darkMode, outline, totalPages, onClose, onPageClick }) {
  const t = useT();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ x: isRTL ? -300 : 300 }}
            animate={{ x: 0 }}
            exit={{ x: isRTL ? -300 : 300 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`w-80 max-w-[85%] h-full ${darkMode ? "bg-gray-800" : "bg-card"} border-l border-border overflow-y-auto ${isRTL ? "mr-auto border-r border-l-0" : "ml-auto"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`p-3 border-b border-border flex items-center justify-between sticky top-0 z-10 ${darkMode ? "bg-gray-800" : "bg-card"}`}>
              <h3 className="text-sm font-bold flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> {t.idxTitle}
              </h3>
              <button onClick={onClose} className="p-1 rounded hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2">
              {outline.length === 0 ? (
                <div>
                  <p className="text-xs text-muted-foreground text-center py-2">{t.idxEmpty}</p>
                  <p className="text-[11px] font-medium text-muted-foreground mb-2 px-1">{t.idxJumpPage}</p>
                  <div className="grid grid-cols-5 gap-1.5 max-h-[55vh] overflow-y-auto pe-1">
                    {Array.from({ length: totalPages || 0 }, (_, i) => i + 1).map((p) => (
                      <button key={p} onClick={() => { onPageClick(p); onClose(); }}
                        className="aspect-square rounded-lg bg-muted/60 hover:bg-primary hover:text-primary-foreground text-xs font-medium transition-colors">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <OutlineTree items={outline} onPageClick={(p) => { onPageClick(p); onClose(); }} darkMode={darkMode} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Search bar with results navigation. */
export function SearchPanel({ show, query, setQuery, onSearch, searching, results, resultIdx, onNextResult, onClose }) {
  const t = useT();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="absolute top-12 left-1/2 -translate-x-1/2 w-80 max-w-[90%] bg-card border border-border rounded-2xl shadow-xl p-3 z-30"
        >
          <div className="flex items-center gap-2">
            <Input
              type="text"
              autoFocus
              placeholder={t.idxSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              className="flex-1 text-sm"
            />
            <Button size="icon" onClick={onSearch} disabled={searching} className="shrink-0">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} className="shrink-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
          {results.length > 0 && (
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className="text-muted-foreground">{resultIdx + 1} / {results.length}</span>
              <button onClick={onNextResult} className="text-primary font-medium hover:underline">{t.idxNext} ←</button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Modal for jumping to a specific page. */
export function GoToPanel({ show, value, setValue, totalPages, onGo, onClose }) {
  const t = useT();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            className="bg-card border border-border rounded-2xl p-4 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              type="number"
              autoFocus
              min="1"
              max={totalPages}
              placeholder={t.idxPageNumber}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onGo()}
              className="w-32 text-center"
            />
            <Button size="sm" onClick={onGo}>{t.idxGo}</Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Recursive outline tree renderer. */
function OutlineTree({ items, onPageClick, darkMode, depth = 0 }) {
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => (
        <div key={i}>
          <button
            onClick={() => item.pageNumber && onPageClick(item.pageNumber)}
            disabled={!item.pageNumber}
            className={`w-full text-right px-2 py-1.5 rounded-lg text-xs transition-colors ${
              item.pageNumber
                ? darkMode ? "hover:bg-gray-700 text-gray-300" : "hover:bg-muted text-foreground"
                : "text-muted-foreground/50 cursor-default"
            }`}
            style={{ paddingRight: `${depth * 12 + 8}px` }}
          >
            {item.title}
            {item.pageNumber && <span className="text-muted-foreground mr-2">({item.pageNumber})</span>}
          </button>
          {item.items?.length > 0 && (
            <OutlineTree items={item.items} onPageClick={onPageClick} darkMode={darkMode} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}