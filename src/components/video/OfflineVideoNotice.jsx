import { useState } from "react";
import { WifiOff, X, Heart, Share2, Check, Clock, Tv } from "lucide-react";
import { useT } from "@/lib/i18n";
import { catLabel } from "@/lib/i18n-terms";
import { getAccountEmail, getVideoFavIds, setVideoFavIds } from "@/lib/activeUser";

/**
 * Shown when the device is offline — displays the cached video thumbnail,
 * title, channel, category, duration, and description, and allows the user
 * to toggle Favorite or copy/share the video link even without internet.
 */
export default function OfflineVideoNotice({ video, onClose }) {
  const t = useT();
  const favEmail = getAccountEmail() || "guest@local";
  const [isFav, setIsFav] = useState(() => {
    if (!video?.id) return false;
    return getVideoFavIds(favEmail).includes(video.id);
  });
  const [copied, setCopied] = useState(false);

  const toggleFav = () => {
    if (!video?.id) return;
    const current = getVideoFavIds(favEmail);
    const exists = current.includes(video.id);
    const next = exists
      ? current.filter((id) => id !== video.id)
      : [...current, video.id];
    setVideoFavIds(favEmail, next);
    setIsFav(!exists);
  };

  const handleShare = async () => {
    const shareUrl = video?.youtube_url || window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: video?.title || "DAR AL TAWHID",
          text: video?.description || video?.title || "",
          url: shareUrl,
        });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 px-4 py-6 overflow-y-auto"
      dir={t.dir || "rtl"}
    >
      <div className="w-full max-w-md rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden text-white shadow-2xl">
        {/* Thumbnail / Preview Banner */}
        <div className="relative aspect-video bg-neutral-800 overflow-hidden">
          {video?.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt={video.title || ""}
              className="w-full h-full object-cover opacity-55"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-black/50 to-black/30 flex flex-col items-center justify-center p-4 text-center">
            <div className="w-14 h-14 mb-2.5 rounded-2xl bg-orange-500/20 border border-orange-400/30 flex items-center justify-center">
              <WifiOff className="w-7 h-7 text-orange-400" />
            </div>
            <p className="text-xs font-semibold text-orange-300 px-3 py-1 rounded-full bg-black/60 border border-orange-400/20">
              {t.videoNeedsNet || t.offlineMode}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 end-3 w-9 h-9 rounded-full bg-black/65 hover:bg-black/85 text-white flex items-center justify-center border border-white/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Metadata & Offline Actions */}
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
              {video?.channel_name && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-white/10 font-medium">
                  <Tv className="w-3 h-3 text-primary" />
                  {video.channel_name}
                </span>
              )}
              {video?.category && (
                <span className="px-2.5 py-0.5 rounded-md bg-primary/20 text-primary font-semibold">
                  {catLabel(video.category, t)}
                </span>
              )}
              {video?.duration && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 font-mono">
                  <Clock className="w-3 h-3" />
                  {video.duration}
                </span>
              )}
            </div>

            <h3 className="text-base font-bold leading-snug">{video?.title}</h3>
          </div>

          {video?.description && (
            <div className="max-h-36 overflow-y-auto rounded-2xl bg-white/5 border border-white/10 p-3 text-xs text-white/80 leading-relaxed whitespace-pre-line">
              {video.description}
            </div>
          )}

          {/* Offline Action Buttons: Favorite, Share, Close */}
          <div className="flex items-center gap-2 pt-1">
            {video?.id && (
              <button
                type="button"
                onClick={toggleFav}
                className={`flex-1 h-10 px-3 rounded-xl font-bold text-xs inline-flex items-center justify-center gap-1.5 border transition-colors ${
                  isFav
                    ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                    : "bg-white/10 border-white/15 text-white hover:bg-white/15"
                }`}
              >
                <Heart className={`w-4 h-4 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
                <span>{isFav ? t.favorited || "في المفضلة" : t.addToFav || "حفظ في المفضلة"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              className="h-10 px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>{t.linkCopied || "تم النسخ"}</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  <span>{t.shareBook || "مشاركة"}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs inline-flex items-center justify-center gap-1.5"
            >
              <X className="w-4 h-4" />
              <span>{t.close}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}