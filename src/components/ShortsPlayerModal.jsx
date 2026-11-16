import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Volume2, VolumeX, ChevronUp, ChevronDown,
  Flame, Tv, Play
} from "lucide-react";
import { extractYoutubeId, getThumbnail } from "@/lib/youtubeMeta";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { markVideoWatched, getAccountEmail } from "@/lib/activeUser";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import OfflineVideoNotice from "@/components/video/OfflineVideoNotice";

export default function ShortsPlayerModal({
  initialVideo,
  shortsList = [],
  channelsById = {},
  isOpen,
  onClose,
  user = null,
}) {
  const t = useT();
  const { isOnline } = useOnlineStatus();

  const list = shortsList.length > 0 ? shortsList : (initialVideo ? [initialVideo] : []);
  const initialIndex = list.findIndex((v) => v.id === initialVideo?.id);
  const [currentIndex, setCurrentIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const playerInstanceRef = useRef(null);
  const playerMountRef = useRef(null);
  const currentVideoIdRef = useRef(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const currentVideo = list[currentIndex] || initialVideo;
  const videoId = extractYoutubeId(currentVideo?.youtube_url);
  const currentChannel = currentVideo?.channel_id ? channelsById[currentVideo.channel_id] : null;
  const channelLogo = currentChannel?.channel_logo || currentVideo?.channel_logo || "";
  const channelName = currentChannel?.name || currentVideo?.channel_name || "";
  const posterUrl = currentVideo?.thumbnail || (videoId ? getThumbnail(currentVideo?.youtube_url) : "");

  // Hide mobile bottom-nav while ShortsPlayerModal is open, restore on close
  useEffect(() => {
    if (!isOpen) return;
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
    };
  }, [isOpen]);

  // Sync index when initialVideo changes
  useEffect(() => {
    if (initialVideo) {
      const idx = list.findIndex((v) => v.id === initialVideo.id);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [initialVideo, list]);

  // Record watched when currentVideo changes
  useEffect(() => {
    if (currentVideo?.id) {
      markVideoWatched(getAccountEmail(user), currentVideo.id);
    }
  }, [currentVideo, user]);

  // Hide swipe hint after 3 seconds
  useEffect(() => {
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  // Initialize official YT.Player once when modal opens, and reuse it via loadVideoById on swipe
  useEffect(() => {
    if (!isOpen || !videoId) return;
    let cancelled = false;

    const createOrUpdatePlayer = () => {
      if (cancelled) return;
      const YT = /** @type {any} */ (window).YT;
      if (!YT?.Player) return;

      // If player already exists, switch video directly inside the unlocked player instance
      if (
        playerInstanceRef.current &&
        typeof playerInstanceRef.current.loadVideoById === "function"
      ) {
        if (currentVideoIdRef.current !== videoId) {
          currentVideoIdRef.current = videoId;
          setPlaying(false);
          try {
            playerInstanceRef.current.loadVideoById({
              videoId,
              startSeconds: 0,
            });
            if (mutedRef.current) {
              playerInstanceRef.current.mute?.();
            } else {
              playerInstanceRef.current.unMute?.();
            }
            playerInstanceRef.current.playVideo?.();
          } catch {}
        }
        return;
      }

      if (!playerMountRef.current) return;
      currentVideoIdRef.current = videoId;
      setReady(false);
      setPlaying(false);

      // Create a fresh child div inside playerMountRef for YT.Player to replace
      playerMountRef.current.innerHTML = "";
      const targetEl = document.createElement("div");
      targetEl.style.width = "100%";
      targetEl.style.height = "100%";
      playerMountRef.current.appendChild(targetEl);

      playerInstanceRef.current = new YT.Player(targetEl, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          fs: 0,
          disablekb: 1,
          loop: 1,
          playlist: videoId,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            setReady(true);
            try {
              if (mutedRef.current) {
                e.target.mute();
              } else {
                e.target.unMute();
                e.target.setVolume(100);
              }
              e.target.playVideo();
            } catch {}
          },
          onStateChange: (e) => {
            if (cancelled) return;
            const YTState = /** @type {any} */ (window).YT?.PlayerState;
            if (e.data === YTState?.PLAYING) {
              setPlaying(true);
              setReady(true);
            } else if (e.data === YTState?.PAUSED) {
              setPlaying(false);
            } else if (e.data === YTState?.ENDED) {
              // Seamless loop
              try {
                e.target.seekTo(0, true);
                e.target.playVideo();
              } catch {}
            } else if (e.data === YTState?.CUED) {
              try {
                e.target.playVideo();
              } catch {}
            }
          },
        },
      });
    };

    if (/** @type {any} */ (window).YT?.Player) {
      createOrUpdatePlayer();
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
      const interval = setInterval(() => {
        if (/** @type {any} */ (window).YT?.Player) {
          clearInterval(interval);
          createOrUpdatePlayer();
        }
      }, 80);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, videoId]);

  // Destroy player when modal closes
  useEffect(() => {
    if (!isOpen && playerInstanceRef.current) {
      try {
        playerInstanceRef.current.destroy();
      } catch {}
      playerInstanceRef.current = null;
      currentVideoIdRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (playerInstanceRef.current) {
        try {
          playerInstanceRef.current.destroy();
        } catch {}
        playerInstanceRef.current = null;
      }
    };
  }, []);

  const toggleMute = useCallback((e) => {
    if (e) e.stopPropagation();
    const p = playerInstanceRef.current;
    setMuted((prev) => {
      const next = !prev;
      try {
        if (next) p?.mute?.();
        else {
          p?.unMute?.();
          p?.setVolume?.(100);
        }
      } catch {}
      return next;
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    const p = playerInstanceRef.current;
    if (!p) return;
    try {
      const YTState = /** @type {any} */ (window).YT?.PlayerState;
      const state = p.getPlayerState?.();
      if (state === YTState?.PLAYING) {
        p.pauseVideo?.();
        setPlaying(false);
      } else {
        p.playVideo?.();
        setPlaying(true);
      }
    } catch {}
  }, []);

  const goToNext = useCallback(() => {
    if (currentIndex < list.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      toast.info(t.reachedLastShort || "وصلت إلى آخر مقطع قصير");
    }
  }, [currentIndex, list.length, t.reachedLastShort]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  // Keyboard navigation (ArrowDown / ArrowUp / Escape / M / Space)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "Escape") {
        onClose();
      } else if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToNext, goToPrev, onClose, toggleMute, togglePlayPause]);

  // Throttled mouse wheel scroll navigation
  const wheelLockRef = useRef(false);
  const handleWheel = useCallback((e) => {
    if (wheelLockRef.current) return;
    if (Math.abs(e.deltaY) > 30) {
      wheelLockRef.current = true;
      if (e.deltaY > 0) {
        goToNext();
      } else {
        goToPrev();
      }
      setTimeout(() => {
        wheelLockRef.current = false;
      }, 550);
    }
  }, [goToNext, goToPrev]);

  // Touch & pointer drag gesture handling (Swipe up / down + tap to play/pause)
  const dragStartY = useRef(null);
  const dragStartX = useRef(null);
  const didSwipeRef = useRef(false);

  const handleTouchStart = (e) => {
    didSwipeRef.current = false;
    dragStartY.current = e.touches?.[0]?.clientY ?? null;
    dragStartX.current = e.touches?.[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e) => {
    if (dragStartY.current === null) return;
    const endY = e.changedTouches?.[0]?.clientY;
    const endX = e.changedTouches?.[0]?.clientX;
    if (typeof endY === "number") {
      const deltaY = endY - dragStartY.current;
      const deltaX = typeof endX === "number" && dragStartX.current !== null ? Math.abs(endX - dragStartX.current) : 0;
      if (Math.abs(deltaY) > 35 && Math.abs(deltaY) > deltaX) {
        didSwipeRef.current = true;
        if (deltaY < -35) {
          goToNext(); // Swipe Up -> Next short
        } else if (deltaY > 35) {
          goToPrev(); // Swipe Down -> Prev short
        }
      }
    }
    dragStartY.current = null;
    dragStartX.current = null;
  };

  const handleMouseDown = (e) => {
    didSwipeRef.current = false;
    dragStartY.current = e.clientY;
  };

  const handleMouseUp = (e) => {
    if (dragStartY.current === null) return;
    const deltaY = e.clientY - dragStartY.current;
    if (Math.abs(deltaY) > 45) {
      didSwipeRef.current = true;
      if (deltaY < -45) {
        goToNext();
      } else if (deltaY > 45) {
        goToPrev();
      }
    }
    dragStartY.current = null;
  };

  const handleShieldTap = () => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    togglePlayPause();
  };

  if (!isOpen || !currentVideo) return null;

  if (!isOnline) {
    return <OfflineVideoNotice video={currentVideo} onClose={onClose} />;
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 select-none overflow-hidden"
      style={{ height: "100dvh", touchAction: "none" }}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
      dir={t.dir}
    >
      {/* Close button top corner */}
      <button
        onClick={onClose}
        className="absolute top-3 left-3 sm:top-5 sm:left-5 z-50 p-2.5 rounded-full bg-black/65 hover:bg-black/85 text-white/95 hover:text-white transition-colors border border-white/15 shadow-lg"
        title={t.close || "إغلاق"}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Main Responsive 9:16 Shorts Container (fits all phones, tablets, foldables, and desktops) */}
      <div className="relative w-full h-full sm:h-[90dvh] sm:w-auto sm:aspect-[9/16] max-w-full sm:rounded-3xl overflow-hidden bg-black shadow-2xl flex flex-col justify-between sm:border sm:border-white/15">
        {/* Video Player Layer */}
        <div className="absolute inset-0 z-0 bg-black flex items-center justify-center overflow-hidden">
          {videoId ? (
            <>
              {/* Persistent YouTube API Player Container (cropped slightly at top/bottom to hide YouTube embed bars) */}
              <div
                ref={playerMountRef}
                className="w-full h-[118%] -my-[9%] pointer-events-none select-none overflow-hidden"
              />

              {/* Thumbnail cover shown only until video starts playing */}
              {!playing && posterUrl && (
                <div className="absolute inset-0 z-[2] bg-black pointer-events-none overflow-hidden">
                  <img
                    src={posterUrl}
                    alt={currentVideo.title}
                    className={`w-full h-full object-cover ${
                      posterUrl.includes("hqdefault") ? "scale-[1.35]" : ""
                    }`}
                  />
                  <div className="absolute inset-0 bg-black/30" />
                </div>
              )}

              {/* Loading spinner before ready */}
              {!ready && (
                <div className="absolute inset-0 z-[3] flex items-center justify-center pointer-events-none">
                  <div className="w-11 h-11 border-4 border-white/25 border-t-purple-500 rounded-full animate-spin" />
                </div>
              )}

              {/* Play indicator when paused */}
              {ready && !playing && (
                <div className="absolute inset-0 z-[4] flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-2xl ring-4 ring-white/25">
                    <Play className="w-7 h-7 fill-current ml-0.5" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/50 p-6 text-center">
              <Tv className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">{t.videoLinkNotAvailable || "رابط المقطع غير متوفر"}</p>
            </div>
          )}

          {/* Protective Touch/Swipe Shield: Blocks all interaction with YouTube iframe while handling swipe & tap */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleShieldTap}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        {/* Top Bar: Fire drop icon ONLY + Mute/Unmute button */}
        <div className="relative z-20 p-3.5 sm:p-4 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-600/90 text-white shadow-md flex items-center justify-center border border-white/15">
              <Flame className="w-4 h-4 fill-current" />
            </span>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto mr-10 sm:mr-0">
            <button
              onClick={toggleMute}
              className="p-2.5 rounded-full bg-black/55 hover:bg-black/75 text-white border border-white/15 transition-colors shadow-md"
              title={muted ? (t.unmute || "تشغيل الصوت") : (t.mute || "كتم الصوت")}
            >
              {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-white" />}
            </button>
          </div>
        </div>

        {/* Vertical Swipe Navigation Arrows */}
        {list.length > 1 && (
          <div className="absolute left-3 bottom-24 z-30 flex flex-col items-center gap-2.5 text-white">
            <button
              onClick={(e) => { e.stopPropagation(); goToPrev(); }}
              disabled={currentIndex === 0}
              className={`p-2.5 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md text-white border border-white/15 transition-all active:scale-90 ${
                currentIndex === 0 ? "opacity-30 cursor-not-allowed" : "opacity-90 hover:opacity-100"
              }`}
              title={t.prevShortUp || "المقطع السابق"}
            >
              <ChevronUp className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); goToNext(); }}
              disabled={currentIndex === list.length - 1}
              className={`p-2.5 rounded-full bg-black/55 hover:bg-black/75 backdrop-blur-md text-white border border-white/15 transition-all active:scale-90 ${
                currentIndex === list.length - 1 ? "opacity-30 cursor-not-allowed" : "opacity-90 hover:opacity-100"
              }`}
              title={t.nextShortDown || "المقطع التالي"}
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Bottom Overlay Info (Read-Only Channel & Title) */}
        <div className="relative z-20 p-4 pb-6 bg-gradient-to-t from-black/95 via-black/75 to-transparent text-white space-y-2 pointer-events-none pl-16">
          {channelName && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-purple-600/30 border border-white/25 overflow-hidden flex items-center justify-center font-bold text-xs text-white shadow shrink-0">
                {channelLogo ? (
                  <img src={channelLogo} alt={channelName} className="w-full h-full object-cover" />
                ) : (
                  <Tv className="w-4 h-4 text-white" />
                )}
              </div>
              <span className="font-bold text-xs sm:text-sm text-white drop-shadow block truncate">
                {channelName}
              </span>
            </div>
          )}

          <h2 className="text-xs sm:text-sm font-bold leading-relaxed line-clamp-2 text-white/95 drop-shadow">
            {currentVideo.title}
          </h2>

          <AnimatePresence>
            {showHint && list.length > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] text-white/90 border border-white/20"
              >
                <ChevronUp className="w-3.5 h-3.5 animate-bounce" />
                <span>{t.swipeNavHint || "مرر للأعلى أو للأسفل للتنقل بين المقاطع"}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
