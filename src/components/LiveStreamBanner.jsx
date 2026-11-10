import { useState, useEffect } from "react";
import { Radio, ExternalLink, Play, Tv } from "lucide-react";
import { getVideoChannels } from "@/lib/offlineSync";
import { useT } from "@/lib/i18n";
import SmartImage from "./SmartImage";

export default function LiveStreamBanner({ onPlayLive = null }) {
  const t = useT();
  const [liveStreams, setLiveStreams] = useState([]);
  const [loading, setLoading] = useState(false);

  const checkLive = async () => {
    try {
      const channels = await getVideoChannels();
      if (!channels || channels.length === 0) return;

      const res = await fetch("/api/check-live-streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: channels.map((c) => ({
            id: c.id,
            name: c.name,
            youtube_url: c.youtube_url,
          })),
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.liveStreams)) {
        setLiveStreams(data.liveStreams);
      }
    } catch (e) {
      // Ignore background fetch error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkLive();
    // Poll every 90 seconds so live streams appear automatically
    const interval = setInterval(checkLive, 90000);
    return () => clearInterval(interval);
  }, []);

  if (liveStreams.length === 0) return null;

  return (
    <div className="mb-8 space-y-4">
      {liveStreams.map((stream) => (
        <div
          key={stream.id || stream.videoId}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-red-600/15 via-red-500/10 to-card border-2 border-red-500/40 p-4 sm:p-5 shadow-xl shadow-red-500/10 animate-fade-in"
        >
          {/* Header Row */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-600"></span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600 text-white text-xs font-black shadow-xs tracking-wide">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                {t.videoLive || "بث مباشر الآن"}
              </span>
            </div>

            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1">
              <Tv className="w-3.5 h-3.5 text-primary" />
              {stream.channel_name}
            </span>
          </div>

          {/* Main Content Row */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="relative w-full sm:w-48 aspect-video rounded-2xl overflow-hidden bg-black shrink-0 shadow-md group">
              <SmartImage
                src={stream.thumbnail || `https://img.youtube.com/vi/${stream.videoId}/hqdefault.jpg`}
                alt={stream.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <Play className="w-5 h-5 fill-white ms-0.5" />
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0 text-center sm:text-start">
              <h3 className="font-black text-base sm:text-lg text-foreground line-clamp-2 leading-snug mb-1">
                {stream.title}
              </h3>
              <p className="text-xs text-muted-foreground line-clamp-1 mb-4">
                {stream.channel_name} • {t.videoLive || "بث مباشر مستمر عبر يوتيوب"}
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                {onPlayLive ? (
                  <button
                    onClick={() => onPlayLive(stream)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[4px_20px_4px_20px] bg-red-600 text-white text-xs font-black shadow-md hover:bg-red-700 active:scale-95 transition-all"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>{t.watchNow || "مشاهدة البث الآن"}</span>
                  </button>
                ) : (
                  <a
                    href={stream.youtube_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[4px_20px_4px_20px] bg-red-600 text-white text-xs font-black shadow-md hover:bg-red-700 active:scale-95 transition-all"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>{t.watchNow || "مشاهدة البث الآن"}</span>
                  </a>
                )}

                <a
                  href={stream.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[4px_20px_4px_20px] bg-card border border-border text-foreground hover:bg-muted text-xs font-bold active:scale-95 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-red-500" />
                  <span>{t.openYoutubeChannel || "يوتيوب"}</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
