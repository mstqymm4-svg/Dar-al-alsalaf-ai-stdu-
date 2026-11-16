import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  DownloadCloud, Loader2, CheckCircle2, Film, Clock, ExternalLink,
  CheckSquare, Square, AlertCircle, Sparkles, Tv
} from "lucide-react";
import { fetchChannelVideos, extractYoutubeId, getThumbnail } from "@/lib/youtubeMeta";

export default function ChannelVideosImportModal({
  channel,
  isOpen,
  onClose,
  onSuccess,
  initialType = "all",
}) {
  const [contentType, setContentType] = useState(initialType || "all"); // "shorts" | "videos" | "all"
  const [limit, setLimit] = useState("25");
  const [customLimit, setCustomLimit] = useState("");
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [existingVideoUrls, setExistingVideoUrls] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const existingSetRef = useRef(new Set());

  const handleFetchVideos = useCallback(
    async (overrideType, overrideExistingSet) => {
      if (!channel?.youtube_url) {
        toast.error("القناة لا تحتوي على رابط يوتيوب صالح");
        return;
      }

      const activeType = overrideType || contentType;
      const activeExisting = overrideExistingSet || existingSetRef.current;

      setLoading(true);
      setVideos([]);
      setSelectedIds(new Set());

      try {
        const fetched = await fetchChannelVideos(channel.youtube_url, limit, activeType);
        if (!fetched || fetched.length === 0) {
          toast.error(
            activeType === "shorts"
              ? "تعذر العثور على مقاطع قصيرة (Shorts) في هذه القناة"
              : "تعذر العثور على فيديوهات في القناة، تأكد من صحة الرابط"
          );
          setLoading(false);
          return;
        }

        setVideos(fetched);

        // Auto-select videos that are not yet in the database
        const newIds = new Set();
        fetched.forEach((v) => {
          const id = extractYoutubeId(v.youtube_url);
          if (id && !activeExisting.has(id)) {
            newIds.add(id);
          }
        });
        setSelectedIds(newIds);

        toast.success(
          activeType === "shorts"
            ? `تم استخراج ${fetched.length} مقطع قصير (Shorts) مع العناوين والبيانات تلقائياً ✓`
            : `تم استخراج ${fetched.length} فيديو من القناة ✓`
        );
      } catch (err) {
        console.error("Error fetching channel videos:", err);
        toast.error("حدث خطأ أثناء الاتصال باليوتيوب");
      } finally {
        setLoading(false);
      }
    },
    [channel, contentType, limit]
  );

  // Load existing videos from DB when modal opens to mark duplicates, then auto-fetch immediately
  useEffect(() => {
    if (!isOpen || !channel) return;
    const startType = initialType || "all";
    setContentType(startType);
    setVideos([]);
    setSelectedIds(new Set());
    setProgress({ current: 0, total: 0 });

    base44.entities.Video.list("-created_date", 1000)
      .then((list) => {
        const set = new Set();
        (list || []).forEach((v) => {
          const id = extractYoutubeId(v.youtube_url);
          if (id) set.add(id);
        });
        existingSetRef.current = set;
        setExistingVideoUrls(set);
        if (channel?.youtube_url) {
          handleFetchVideos(startType, set);
        }
      })
      .catch(() => {
        if (channel?.youtube_url) {
          handleFetchVideos(startType, new Set());
        }
      });
  }, [isOpen, channel, initialType, handleFetchVideos]);

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = (select) => {
    if (!select) {
      setSelectedIds(new Set());
      return;
    }
    const all = new Set();
    videos.forEach((v) => {
      const id = extractYoutubeId(v.youtube_url);
      if (id) all.add(id);
    });
    setSelectedIds(all);
  };

  const handleStartImport = async () => {
    const toImport = videos.filter((v) => {
      const id = extractYoutubeId(v.youtube_url);
      return id && selectedIds.has(id);
    });

    if (toImport.length === 0) {
      toast.error("يرجى تحديد مقطع واحد على الأقل للاستيراد");
      return;
    }

    setImporting(true);
    setProgress({ current: 0, total: toImport.length });

    let successCount = 0;
    for (let i = 0; i < toImport.length; i++) {
      const v = toImport[i];
      const isShort = v.video_type === "short" || contentType === "shorts" || v.youtube_url?.includes("/shorts/");
      try {
        await base44.entities.Video.create({
          title: v.title,
          youtube_url: v.youtube_url,
          duration: v.duration || (isShort ? "0:60" : ""),
          thumbnail: v.thumbnail || getThumbnail(v.youtube_url),
          channel_id: channel.id || "",
          channel_name: channel.name || v.channel_name || "",
          category: channel.category || "عام",
          video_type: isShort ? "short" : (v.video_type || "normal"),
          description: v.description || "",
          is_featured: false,
          visible: true,
          sort_order: 0,
        });
        successCount++;
      } catch (err) {
        console.error("Failed to import video:", v.title, err);
      }
      setProgress({ current: i + 1, total: toImport.length });
    }

    setImporting(false);
    toast.success(`تم استيراد ${successCount} مقطع بنجاح إلى التطبيق! 🎉`);
    if (onSuccess) onSuccess();
    onClose();
  };

  if (!channel) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !importing && !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-2xl" dir="rtl">
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 overflow-hidden border border-border">
              {channel.channel_logo ? (
                <img src={channel.channel_logo} alt={channel.name} className="w-full h-full object-cover" />
              ) : (
                <Tv className="w-6 h-6 text-red-500" />
              )}
            </div>
            <div className="flex-1 min-w-0 text-right">
              <DialogTitle className="text-base sm:text-lg font-bold flex items-center gap-2 flex-wrap">
                <span>استيراد المقاطع من القناة تلقائياً</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                  {channel.name}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate">
                <span dir="ltr">{channel.youtube_url}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Controls bar */}
          <div className="bg-muted/40 border border-border rounded-xl p-3.5 space-y-3">
            {/* Content Type Selector: Shorts vs Regular vs All */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-foreground block">
                نوع المقاطع المطلوب سحبها من القناة:
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={loading || importing}
                  onClick={() => {
                    setContentType("shorts");
                    handleFetchVideos("shorts");
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                    contentType === "shorts"
                      ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                      : "bg-card border-border hover:border-purple-500/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>🟣 المقاطع القصيرة (Shorts)</span>
                </button>
                <button
                  type="button"
                  disabled={loading || importing}
                  onClick={() => {
                    setContentType("videos");
                    handleFetchVideos("videos");
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                    contentType === "videos"
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>📺 الفيديوهات العادية</span>
                </button>
                <button
                  type="button"
                  disabled={loading || importing}
                  onClick={() => {
                    setContentType("all");
                    handleFetchVideos("all");
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                    contentType === "all"
                      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                      : "bg-card border-border hover:border-amber-500/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>🔥 الكل معاً</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Label className="text-xs font-bold text-foreground">
                عدد المقاطع المطلوب استخراجها:
              </Label>
              <span className="text-[11px] text-muted-foreground">
                يجلب العنوان والصورة واسم القناة والمدة تلقائياً
              </span>
            </div>

            {/* Limit selection buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => { setLimit("10"); setCustomLimit(""); }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                  limit === "10" && !customLimit
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                10 مقاطع
              </button>

              <button
                type="button"
                onClick={() => { setLimit("25"); setCustomLimit(""); }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                  limit === "25" && !customLimit
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                25 مقطع
              </button>

              <button
                type="button"
                onClick={() => { setLimit("50"); setCustomLimit(""); }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                  limit === "50" && !customLimit
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                50 مقطع
              </button>

              <button
                type="button"
                onClick={() => { setLimit("all"); setCustomLimit(""); }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                  limit === "all"
                    ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                    : "bg-card border-border hover:border-amber-500/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                🔥 جميع المقاطع (الكل)
              </button>
            </div>

            {/* Custom Input or summary */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/50">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Label className="text-xs shrink-0">أو اكتب أي عدد يدوياً:</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={customLimit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomLimit(val);
                    if (val) setLimit(val);
                  }}
                  placeholder="مثال: 15 أو 40"
                  className="h-8 text-xs w-36 bg-background font-mono"
                  disabled={loading || importing}
                />
              </div>

              <Button
                size="sm"
                onClick={() => handleFetchVideos(contentType)}
                disabled={loading || importing}
                className={`h-9 text-xs gap-1.5 shadow-sm font-bold shrink-0 ${
                  contentType === "shorts"
                    ? "bg-purple-600 hover:bg-purple-700 text-white"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري الاستخراج من القناة...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    {contentType === "shorts"
                      ? `سحب المقاطع القصيرة (${limit === "all" ? "الكل" : customLimit || limit})`
                      : limit === "all"
                      ? "استخراج جميع مقاطع القناة"
                      : `استخراج (${customLimit || limit}) مقطع`}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Loading state */}
          {loading && videos.length === 0 && (
            <div className="text-center py-12 px-4 border border-dashed border-purple-500/30 bg-purple-500/5 rounded-xl space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto" />
              <div className="max-w-sm mx-auto">
                <h4 className="font-bold text-sm text-foreground">
                  {contentType === "shorts"
                    ? "جاري سحب المقاطع القصيرة (Shorts) وعناوينها من القناة..."
                    : "جاري استخراج مقاطع القناة وعناوينها..."}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  يرجى الانتظار لحظات بينما يتم جلب الأسماء والصور تلقائياً.
                </p>
              </div>
            </div>
          )}

          {/* Prompt before fetching */}
          {!loading && videos.length === 0 && (
            <div className="text-center py-10 px-4 border border-dashed border-border rounded-xl space-y-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Film className="w-6 h-6" />
              </div>
              <div className="max-w-sm mx-auto">
                <h4 className="font-bold text-sm text-foreground">
                  {contentType === "shorts"
                    ? "جاهز لسحب المقاطع القصيرة (Shorts) من القناة"
                    : "جاهز لاستخراج المقاطع من القناة"}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  اضغط على زر الاستخراج أعلاه ليقوم النظام بجلب المقاطع وعناوينها وصورها واسم القناة تلقائياً.
                </p>
              </div>
            </div>
          )}

          {/* Videos List */}
          {videos.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  تم العثور على <strong className="text-foreground">{videos.length}</strong> مقطع
                  (تم تحديد <strong className="text-primary">{selectedIds.size}</strong>)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="hover:text-primary font-medium flex items-center gap-1"
                  >
                    <CheckSquare className="w-3.5 h-3.5" /> تحديد الكل
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="hover:text-primary font-medium flex items-center gap-1"
                  >
                    <Square className="w-3.5 h-3.5" /> إلغاء التحديد
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                {videos.map((v) => {
                  const vId = extractYoutubeId(v.youtube_url);
                  const isExisting = vId && existingVideoUrls.has(vId);
                  const isSelected = vId && selectedIds.has(vId);
                  const isShortItem = v.video_type === "short" || v.youtube_url?.includes("/shorts/");

                  return (
                    <div
                      key={v.youtube_url}
                      onClick={() => !importing && vId && toggleSelect(vId)}
                      className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-primary/5 border-primary/40 shadow-sm"
                          : "bg-card border-border hover:border-border/80"
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="shrink-0">
                        {isSelected ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : (
                          <div className="w-5 h-5 rounded-md border border-muted-foreground/40" />
                        )}
                      </div>

                      {/* Thumbnail (Vertical 9:16 for Shorts, 16:9 for Regular) */}
                      <div
                        className={`relative ${
                          isShortItem ? "w-14 aspect-[9/16]" : "w-24 aspect-video"
                        } rounded-lg overflow-hidden bg-black shrink-0 border border-border/50`}
                      >
                        <img
                          src={v.thumbnail || getThumbnail(v.youtube_url)}
                          alt={v.title}
                          className="w-full h-full object-cover"
                        />
                        {v.duration && !isShortItem && (
                          <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/85 text-white text-[9px] font-mono flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {v.duration}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 text-right">
                        <p className="text-xs font-bold line-clamp-2 leading-snug">{v.title}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {isShortItem && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-600/15 text-purple-600 dark:text-purple-400 font-bold">
                              🟣 شورتس
                            </span>
                          )}
                          {isExisting ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 text-amber-500" /> مضاف مسبقاً
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                              جديد
                            </span>
                          )}
                          <a
                            href={v.youtube_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
                          >
                            معاينة <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Progress Bar during Import */}
          {importing && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5 text-primary">
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري استيراد المقاطع وحفظها...
                </span>
                <span className="font-mono text-primary">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-3 sm:p-4 border-t border-border bg-card flex sm:justify-between items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={importing}
            onClick={onClose}
            className="text-xs"
          >
            إلغاء
          </Button>

          {videos.length > 0 && (
            <Button
              size="sm"
              disabled={importing || selectedIds.size === 0}
              onClick={handleStartImport}
              className={`text-xs gap-1.5 font-bold shadow-md ${
                contentType === "shorts"
                  ? "bg-purple-600 hover:bg-purple-700 text-white"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              }`}
            >
              {importing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري الاستيراد ({progress.current}/{progress.total})...
                </>
              ) : (
                <>
                  <DownloadCloud className="w-4 h-4" /> استيراد المقاطع المحددة ({selectedIds.size})
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
