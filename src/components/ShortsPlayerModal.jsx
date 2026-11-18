import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronUp, Flame, Tv, Play } from "lucide-react";
import { extractYoutubeId, getThumbnail } from "@/lib/youtubeMeta";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { markVideoWatched, getAccountEmail } from "@/lib/activeUser";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import OfflineVideoNotice from "@/components/video/OfflineVideoNotice";

// Helper to detect direct HTML5 video URLs (MP4 / WebM / M3U8 / Blob / Data)
function isDirectVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("data:video/") || trimmed.startsWith("blob:")) return true;
  if (/\.(mp4|webm|m3u8|mov)(\?.*)?$/i.test(trimmed)) return true;
  return false;
}

// Instant postMessage command sender to YouTube embed iframe
function sendYoutubeCommand(iframeEl, func, args = []) {
  if (!iframeEl?.contentWindow) return;
  try {
    iframeEl.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  } catch {}
}

// Register YouTube widget listener on an iframe so it emits onReady, onStateChange & infoDelivery
function sendYoutubeListeningHandshake(iframeEl, slideIdx) {
  if (!iframeEl?.contentWindow) return;
  try {
    iframeEl.contentWindow.postMessage(
      JSON.stringify({
        event: "listening",
        id: slideIdx,
        channel: "widget",
      }),
      "*"
    );
    sendYoutubeCommand(iframeEl, "addEventListener", ["onStateChange"]);
    sendYoutubeCommand(iframeEl, "addEventListener", ["onReady"]);
  } catch {}
}

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

  const list = useMemo(
    () => (shortsList.length > 0 ? shortsList : initialVideo ? [initialVideo] : []),
    [shortsList, initialVideo]
  );

  const initialIndex = list.findIndex((v) => v.id === initialVideo?.id);
  const [currentIndex, setCurrentIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [userPaused, setUserPaused] = useState(false);
  const [slidePlayingMap, setSlidePlayingMap] = useState({});
  const [progress, setProgress] = useState(0);
  const [showHint, setShowHint] = useState(true);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  const currentIndexRef = useRef(currentIndex);
  const listRef = useRef(list);
  const userPausedRef = useRef(false);
  const iframeRefs = useRef({});
  const nativeVideoRefs = useRef({});
  const loadedSlidesRef = useRef({});
  // Locks initial autoplay query parameter per mounted slide so `embedSrc` NEVER mutates across re-renders
  const slideAutoplayParamRef = useRef({});
  // Tracks which slides have confirmed PLAYING (playerState === 1) via YouTube postMessage
  const slidePlayingConfirmedRef = useRef({});
  // Tracks which slides have received any telemetry from YouTube widget API
  const slideHandshakeAckRef = useRef({});
  // Tracks which slides have played at least once so we only rewind them when they become inactive
  const playedOnceRef = useRef({});

  currentIndexRef.current = currentIndex;
  listRef.current = list;

  const currentVideo = list[currentIndex] || initialVideo;
  const currentChannel = currentVideo?.channel_id ? channelsById[currentVideo.channel_id] : null;
  const channelLogo = currentChannel?.channel_logo || currentVideo?.channel_logo || "";
  const channelName = currentChannel?.name || currentVideo?.channel_name || "";

  // Hide mobile bottom-nav while ShortsPlayerModal is open, restore on close
  useEffect(() => {
    if (!isOpen) {
      slideAutoplayParamRef.current = {};
      loadedSlidesRef.current = {};
      slidePlayingConfirmedRef.current = {};
      slideHandshakeAckRef.current = {};
      playedOnceRef.current = {};
      setSlidePlayingMap({});
      setDragOffsetY(0);
      return;
    }
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
    };
  }, [isOpen]);

  // Sync index ONLY when modal opens or initialVideo ID changes
  useEffect(() => {
    if (!isOpen || !initialVideo?.id) return;
    const idx = listRef.current.findIndex((v) => v.id === initialVideo.id);
    const targetIdx = idx >= 0 ? idx : 0;
    setCurrentIndex(targetIdx);
    currentIndexRef.current = targetIdx;
    userPausedRef.current = false;
    setUserPaused(false);
    setProgress(0);
    setDragOffsetY(0);
  }, [isOpen, initialVideo?.id]);

  // Preload thumbnails for adjacent Shorts so swipes never flash an empty frame
  useEffect(() => {
    if (!isOpen || list.length === 0) return;
    [currentIndex - 1, currentIndex, currentIndex + 1, currentIndex + 2]
      .filter((i) => i >= 0 && i < list.length)
      .forEach((i) => {
        const item = list[i];
        const thumb = item?.thumbnail || getThumbnail(item?.youtube_url);
        if (thumb) {
          const img = new Image();
          img.src = thumb;
        }
      });
  }, [isOpen, currentIndex, list]);

  // Record watched when currentVideo changes
  useEffect(() => {
    if (isOpen && currentVideo?.id) {
      markVideoWatched(getAccountEmail(user), currentVideo.id);
    }
  }, [isOpen, currentVideo?.id, user]);

  // Show swipe hint once when modal opens, hide after 2.4 seconds
  useEffect(() => {
    if (!isOpen) return;
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 2400);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Helper to command a slide to play or pause immediately without flushing pre-buffered data
  const activateSlidePlayback = useCallback((activeIdx) => {
    // 1. Handle direct HTML5 <video> elements
    Object.entries(nativeVideoRefs.current).forEach(([idxStr, videoEl]) => {
      if (!videoEl) return;
      const idx = Number(idxStr);
      if (idx === activeIdx) {
        videoEl.muted = false;
        const p = videoEl.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            videoEl.muted = true;
            videoEl.play().catch(() => {});
          });
        }
      } else {
        try {
          videoEl.pause();
          videoEl.currentTime = 0;
        } catch {}
      }
    });

    // 2. Handle pre-buffered YouTube embed iframes
    Object.entries(iframeRefs.current).forEach(([idxStr, iframeEl]) => {
      if (!iframeEl) return;
      const idx = Number(idxStr);
      if (idx === activeIdx) {
        sendYoutubeListeningHandshake(iframeEl, idx);
        sendYoutubeCommand(iframeEl, "unMute");
        sendYoutubeCommand(iframeEl, "setVolume", [100]);
        sendYoutubeCommand(iframeEl, "playVideo");
      } else {
        slidePlayingConfirmedRef.current[idx] = false;
        sendYoutubeCommand(iframeEl, "mute");
        sendYoutubeCommand(iframeEl, "pauseVideo");
        if (playedOnceRef.current[idx]) {
          sendYoutubeCommand(iframeEl, "seekTo", [0, true]);
        }
      }
    });
  }, []);

  // Ensure active slide plays and non-active slides stay paused whenever currentIndex changes
  useEffect(() => {
    if (!isOpen) return;
    setProgress(0);
    setDragOffsetY(0);
    userPausedRef.current = false;
    setUserPaused(false);
    slidePlayingConfirmedRef.current[currentIndex] = false;
    activateSlidePlayback(currentIndex);

    // Periodic handshake + playback kick until YouTube confirms PLAYING state, plus poster uncover failsafe
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      if (currentIndexRef.current !== currentIndex || userPausedRef.current) {
        clearInterval(interval);
        return;
      }
      const activeIframe = iframeRefs.current[currentIndex];
      if (!activeIframe) return;

      if (!slideHandshakeAckRef.current[currentIndex]) {
        sendYoutubeListeningHandshake(activeIframe, currentIndex);
      }

      if (!slidePlayingConfirmedRef.current[currentIndex]) {
        sendYoutubeCommand(activeIframe, "unMute");
        sendYoutubeCommand(activeIframe, "setVolume", [100]);
        sendYoutubeCommand(activeIframe, "playVideo");
      }

      // Failsafe: if iframe has loaded and 500ms have elapsed, uncover the poster so it can never get stuck
      if (loadedSlidesRef.current[currentIndex] && attempts >= 3) {
        setSlidePlayingMap((prev) =>
          prev[currentIndex] ? prev : { ...prev, [currentIndex]: true }
        );
      }

      if (slidePlayingConfirmedRef.current[currentIndex] || attempts >= 10) {
        clearInterval(interval);
      }
    }, 180);

    return () => clearInterval(interval);
  }, [isOpen, currentIndex, activateSlidePlayback]);

  // Listen for real-time YouTube postMessage telemetry (initialDelivery / onReady / infoDelivery / onStateChange)
  useEffect(() => {
    if (!isOpen) return;
    const handleMessage = (event) => {
      if (!event?.data || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);

        // Identify the exact slideIdx via data.id OR event.source === iframe.contentWindow
        let slideIdx = typeof data?.id === "number" ? data.id : null;
        if (slideIdx === null) {
          for (const [k, el] of Object.entries(iframeRefs.current)) {
            if (el && el.contentWindow === event.source) {
              slideIdx = Number(k);
              break;
            }
          }
        }
        if (slideIdx === null) slideIdx = currentIndexRef.current;

        slideHandshakeAckRef.current[slideIdx] = true;

        if (data?.event === "onReady" || data?.event === "initialDelivery") {
          const iframeEl = iframeRefs.current[slideIdx];
          if (iframeEl) {
            if (slideIdx === currentIndexRef.current && !userPausedRef.current) {
              sendYoutubeCommand(iframeEl, "unMute");
              sendYoutubeCommand(iframeEl, "setVolume", [100]);
              sendYoutubeCommand(iframeEl, "playVideo");
            } else {
              // Pre-warmed adjacent slide: keep muted & paused at frame 0 so swipe is instant
              sendYoutubeCommand(iframeEl, "mute");
              sendYoutubeCommand(iframeEl, "pauseVideo");
            }
          }
        }

        const info = data?.info;
        const stateCode =
          typeof info === "number"
            ? info
            : typeof info?.playerState === "number"
            ? info.playerState
            : null;

        // playerState === 1 means PLAYING
        if (
          stateCode === 1 ||
          (info && typeof info === "object" && typeof info.currentTime === "number" && info.currentTime > 0.02)
        ) {
          if (slideIdx === currentIndexRef.current) {
            slidePlayingConfirmedRef.current[slideIdx] = true;
            playedOnceRef.current[slideIdx] = true;
            setSlidePlayingMap((prev) =>
              prev[slideIdx] ? prev : { ...prev, [slideIdx]: true }
            );
          } else {
            // Safety guard: if an adjacent pre-warmed slide ever starts playing in background, pause it immediately
            const adjIframe = iframeRefs.current[slideIdx];
            if (adjIframe) {
              sendYoutubeCommand(adjIframe, "mute");
              sendYoutubeCommand(adjIframe, "pauseVideo");
            }
          }
        }

        if (info && typeof info === "object") {
          // Update progress bar for the active slide
          if (
            slideIdx === currentIndexRef.current &&
            typeof info.duration === "number" &&
            info.duration > 0 &&
            typeof info.currentTime === "number"
          ) {
            setProgress(Math.min(100, (info.currentTime / info.duration) * 100));
          }
        }

        // stateCode === 0 means ENDED -> seamless loop from 0
        if (slideIdx === currentIndexRef.current && stateCode === 0) {
          const activeIframe = iframeRefs.current[slideIdx];
          if (activeIframe) {
            sendYoutubeCommand(activeIframe, "seekTo", [0, true]);
            sendYoutubeCommand(activeIframe, "playVideo");
          }
        }
      } catch {}
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isOpen]);

  // Synchronous switch inside user gesture (touch/mouse/wheel/keyboard) so mobile WebViews grant instant unmuted playback
  const switchToIndex = useCallback(
    (nextIdx) => {
      const items = listRef.current;
      if (nextIdx < 0 || nextIdx >= items.length) return;
      const prevIdx = currentIndexRef.current;
      if (prevIdx === nextIdx) return;

      userPausedRef.current = false;
      setUserPaused(false);
      setProgress(0);
      setDragOffsetY(0);
      currentIndexRef.current = nextIdx;
      setCurrentIndex(nextIdx);

      // Trigger playback synchronously inside the user gesture
      activateSlidePlayback(nextIdx);
    },
    [activateSlidePlayback]
  );

  // Single tap on screen: instant Pause / Resume
  const togglePlayPause = useCallback(() => {
    const idx = currentIndexRef.current;
    const nextPaused = !userPausedRef.current;
    userPausedRef.current = nextPaused;
    setUserPaused(nextPaused);

    const nativeEl = nativeVideoRefs.current[idx];
    if (nativeEl) {
      try {
        if (nextPaused) {
          nativeEl.pause();
        } else {
          nativeEl.muted = false;
          nativeEl.play().catch(() => {});
        }
      } catch {}
    }

    const iframeEl = iframeRefs.current[idx];
    if (iframeEl) {
      if (nextPaused) {
        sendYoutubeCommand(iframeEl, "pauseVideo");
      } else {
        sendYoutubeCommand(iframeEl, "unMute");
        sendYoutubeCommand(iframeEl, "setVolume", [100]);
        sendYoutubeCommand(iframeEl, "playVideo");
      }
    }
  }, []);

  const goToNext = useCallback(() => {
    const idx = currentIndexRef.current;
    const len = listRef.current.length;
    if (idx < len - 1) {
      switchToIndex(idx + 1);
    } else if (len > 1) {
      switchToIndex(0);
    } else {
      toast.info(t.reachedLastShort || "وصلت إلى آخر مقطع قصير");
    }
  }, [switchToIndex, t.reachedLastShort]);

  const goToPrev = useCallback(() => {
    const idx = currentIndexRef.current;
    if (idx > 0) {
      switchToIndex(idx - 1);
    }
  }, [switchToIndex]);

  // Keyboard navigation (ArrowDown / ArrowUp / Escape / Space)
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
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToNext, goToPrev, onClose, togglePlayPause]);

  // Throttled mouse wheel scroll navigation
  const wheelLockRef = useRef(false);
  const handleWheel = useCallback(
    (e) => {
      if (wheelLockRef.current) return;
      if (Math.abs(e.deltaY) > 25) {
        wheelLockRef.current = true;
        if (e.deltaY > 0) {
          goToNext();
        } else {
          goToPrev();
        }
        setTimeout(() => {
          wheelLockRef.current = false;
        }, 320);
      }
    },
    [goToNext, goToPrev]
  );

  // Touch & mouse gesture handling (Swipe up/down with live follow + Tap to pause/play)
  const dragStartY = useRef(null);
  const dragStartX = useRef(null);
  const dragStartTime = useRef(0);
  const lastTouchTimeRef = useRef(0);

  const handleTouchStart = (e) => {
    lastTouchTimeRef.current = Date.now();
    dragStartY.current = e.touches?.[0]?.clientY ?? null;
    dragStartX.current = e.touches?.[0]?.clientX ?? null;
    dragStartTime.current = Date.now();
  };

  const handleTouchMove = (e) => {
    if (dragStartY.current === null) return;
    const curY = e.touches?.[0]?.clientY;
    const curX = e.touches?.[0]?.clientX;
    if (typeof curY === "number") {
      const dy = curY - dragStartY.current;
      const dx =
        typeof curX === "number" && dragStartX.current !== null
          ? Math.abs(curX - dragStartX.current)
          : 0;
      if (Math.abs(dy) > 10 && Math.abs(dy) > dx) {
        // Clamp live drag offset for tactile feedback
        const damped = Math.max(-140, Math.min(140, dy * 0.55));
        setDragOffsetY(damped);
      }
    }
  };

  const handleTouchEnd = (e) => {
    lastTouchTimeRef.current = Date.now();
    if (dragStartY.current === null) return;
    const endY = e.changedTouches?.[0]?.clientY;
    const endX = e.changedTouches?.[0]?.clientX;
    setDragOffsetY(0);

    if (typeof endY === "number") {
      const deltaY = endY - dragStartY.current;
      const deltaX =
        typeof endX === "number" && dragStartX.current !== null
          ? Math.abs(endX - dragStartX.current)
          : 0;
      const elapsed = Date.now() - dragStartTime.current;

      if (Math.abs(deltaY) > 24 && Math.abs(deltaY) > deltaX) {
        if (deltaY < -24) {
          goToNext();
        } else if (deltaY > 24) {
          goToPrev();
        }
      } else if (Math.abs(deltaY) < 14 && deltaX < 14 && elapsed < 550) {
        togglePlayPause();
      }
    }
    dragStartY.current = null;
    dragStartX.current = null;
  };

  const handleMouseDown = (e) => {
    if (Date.now() - lastTouchTimeRef.current < 800) return;
    dragStartY.current = e.clientY;
    dragStartX.current = e.clientX;
  };

  const handleMouseUp = (e) => {
    if (Date.now() - lastTouchTimeRef.current < 800) return;
    if (dragStartY.current === null) return;
    const deltaY = e.clientY - dragStartY.current;
    const deltaX = dragStartX.current !== null ? Math.abs(e.clientX - dragStartX.current) : 0;
    if (Math.abs(deltaY) > 35 && Math.abs(deltaY) > deltaX) {
      if (deltaY < -35) {
        goToNext();
      } else if (deltaY > 35) {
        goToPrev();
      }
    } else if (Math.abs(deltaY) < 10 && deltaX < 10) {
      togglePlayPause();
    }
    dragStartY.current = null;
    dragStartX.current = null;
  };

  if (!isOpen || !currentVideo) return null;

  if (!isOnline) {
    return <OfflineVideoNotice video={currentVideo} onClose={onClose} />;
  }

  // Render a 3-slide window (previous, current, next) with STABLE keys & STABLE iframe src!
  // Never changing `src` while a slide is mounted means the next Short is already loaded in the DOM before the user swipes!
  const windowedIndices = [currentIndex - 1, currentIndex, currentIndex + 1].filter(
    (idx) => idx >= 0 && idx < list.length
  );

  // Clean up cached refs for slides that have left the 3-slide window
  const windowSet = new Set(windowedIndices);
  Object.keys(slideAutoplayParamRef.current).forEach((k) => {
    const idx = Number(k);
    if (!windowSet.has(idx)) {
      delete slideAutoplayParamRef.current[idx];
      delete loadedSlidesRef.current[idx];
      delete slidePlayingConfirmedRef.current[idx];
      delete slideHandshakeAckRef.current[idx];
      delete playedOnceRef.current[idx];
    }
  });

  return (
    <div
      className="fixed inset-0 z-[60] bg-black sm:bg-black/95 flex items-center justify-center p-0 sm:p-4 select-none overflow-hidden"
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

      {/* Main Responsive 9:16 Shorts Container */}
      <div className="relative w-full h-full sm:h-[90dvh] sm:w-auto sm:aspect-[9/16] max-w-full sm:rounded-3xl overflow-hidden bg-black shadow-2xl flex flex-col justify-between sm:border sm:border-white/15">
        {/* Multi-Slide Preloaded Video Deck */}
        <div className="absolute inset-0 z-0 bg-black overflow-hidden">
          {windowedIndices.map((slideIdx) => {
            const slideVideo = list[slideIdx];
            const rawUrl = slideVideo?.youtube_url || slideVideo?.file_url || "";
            const slideVidId = extractYoutubeId(rawUrl);
            const isDirectFile = !slideVidId && isDirectVideoUrl(rawUrl);
            const isActive = slideIdx === currentIndex;
            const offsetPercent = (slideIdx - currentIndex) * 100;
            const posterUrl =
              slideVideo?.thumbnail || (slideVidId ? getThumbnail(rawUrl) : "");
            const isSlidePlaying = Boolean(slidePlayingMap[slideIdx]);

            // CRITICAL: Lock `startAutoplay` the first time `slideIdx` enters `windowedIndices`
            // so `embedSrc` NEVER mutates across state updates or swipes!
            if (!(slideIdx in slideAutoplayParamRef.current)) {
              slideAutoplayParamRef.current[slideIdx] = slideIdx === currentIndex ? 1 : 0;
            }
            const startAutoplay = slideAutoplayParamRef.current[slideIdx];

            const embedSrc = slideVidId
              ? `https://www.youtube.com/embed/${slideVidId}?autoplay=${startAutoplay}&mute=0&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&fs=0&disablekb=1&loop=1&playlist=${slideVidId}&enablejsapi=1&origin=${encodeURIComponent(
                  window.location.origin
                )}`
              : "";

            return (
              <div
                key={`short-slide-${slideIdx}-${slideVideo?.id || slideVidId}`}
                className={`absolute inset-0 w-full h-full bg-black will-change-transform overflow-hidden ${
                  dragOffsetY === 0 ? "transition-transform duration-200 ease-out" : ""
                }`}
                style={{
                  transform: `translate3d(0, calc(${offsetPercent}% + ${dragOffsetY}px), 0)`,
                  zIndex: isActive ? 2 : 1,
                }}
              >
                {isDirectFile ? (
                  <>
                    <video
                      ref={(el) => {
                        if (el) nativeVideoRefs.current[slideIdx] = el;
                        else delete nativeVideoRefs.current[slideIdx];
                      }}
                      src={rawUrl}
                      poster={posterUrl}
                      playsInline
                      autoPlay={isActive}
                      loop
                      preload="auto"
                      className="w-full h-full object-cover pointer-events-none select-none"
                      onPlaying={() => {
                        playedOnceRef.current[slideIdx] = true;
                        setSlidePlayingMap((prev) =>
                          prev[slideIdx] ? prev : { ...prev, [slideIdx]: true }
                        );
                      }}
                      onTimeUpdate={(e) => {
                        if (!isActive) return;
                        const el = e.currentTarget;
                        if (el.duration > 0) {
                          setProgress((el.currentTime / el.duration) * 100);
                        }
                      }}
                    />
                    {!isSlidePlaying && posterUrl && (
                      <div className="absolute inset-0 z-[2] bg-black pointer-events-none overflow-hidden">
                        <img
                          src={posterUrl}
                          alt={slideVideo?.title || ""}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </>
                ) : slideVidId ? (
                  <>
                    <iframe
                      ref={(el) => {
                        if (el) iframeRefs.current[slideIdx] = el;
                        else delete iframeRefs.current[slideIdx];
                      }}
                      src={embedSrc}
                      title={slideVideo?.title || "Short"}
                      allow="autoplay; encrypted-media; gyroscope; picture-in-picture"
                      className="w-full h-[128%] -my-[14%] border-0 pointer-events-none select-none"
                      onLoad={(e) => {
                        loadedSlidesRef.current[slideIdx] = true;
                        const iframeEl = e.currentTarget;
                        sendYoutubeListeningHandshake(iframeEl, slideIdx);

                        if (slideIdx === currentIndexRef.current && !userPausedRef.current) {
                          sendYoutubeCommand(iframeEl, "unMute");
                          sendYoutubeCommand(iframeEl, "setVolume", [100]);
                          sendYoutubeCommand(iframeEl, "playVideo");
                          // Failsafe poster uncover after 450ms if postMessage is delayed
                          setTimeout(() => {
                            if (
                              currentIndexRef.current === slideIdx &&
                              !userPausedRef.current
                            ) {
                              setSlidePlayingMap((prev) =>
                                prev[slideIdx] ? prev : { ...prev, [slideIdx]: true }
                              );
                            }
                          }, 450);
                        } else {
                          sendYoutubeCommand(iframeEl, "mute");
                          sendYoutubeCommand(iframeEl, "pauseVideo");
                        }
                      }}
                    />

                    {/* Poster cover stays visible only until playback starts (hides YouTube initial title/spinner) */}
                    {!isSlidePlaying && posterUrl && (
                      <div className="absolute inset-0 z-[2] bg-black pointer-events-none overflow-hidden transition-opacity duration-150">
                        <img
                          src={posterUrl}
                          alt={slideVideo?.title || ""}
                          className={`w-full h-full object-cover ${
                            posterUrl.includes("hqdefault") ? "scale-[1.35]" : ""
                          }`}
                        />
                        <div className="absolute inset-0 bg-black/20" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-white/50 p-6 text-center">
                    <Tv className="w-12 h-12 mb-3 opacity-40" />
                    <p className="text-sm">
                      {t.videoLinkNotAvailable || "رابط المقطع غير متوفر"}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Play indicator ONLY when explicitly paused by user tap */}
          {userPaused && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/65 text-white flex items-center justify-center shadow-2xl ring-2 ring-white/30">
                <Play className="w-7 h-7 fill-current ml-0.5" />
              </div>
            </div>
          )}

          {/* Protective Touch/Swipe Shield: Captures swipe up/down & single tap to pause/resume */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        {/* Top Bar: Fire icon badge */}
        <div className="relative z-20 p-3.5 sm:p-4 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-600/90 text-white shadow-md flex items-center justify-center border border-white/15">
              <Flame className="w-4 h-4 fill-current" />
            </span>
          </div>
        </div>

        {/* Bottom Overlay Info (Channel, Title & Progress Bar) */}
        <div className="relative z-20 p-4 pb-5 bg-gradient-to-t from-black/95 via-black/75 to-transparent text-white space-y-2 pointer-events-none">
          {channelName && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-purple-600/30 border border-white/25 overflow-hidden flex items-center justify-center font-bold text-xs text-white shadow shrink-0">
                {channelLogo ? (
                  <img
                    src={channelLogo}
                    alt={channelName}
                    className="w-full h-full object-cover"
                  />
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
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-[11px] text-white/90 border border-white/20"
              >
                <ChevronUp className="w-3.5 h-3.5 animate-bounce" />
                <span>
                  {t.swipeNavHint || "مرر للأعلى أو للأسفل للتنقل بين المقاطع"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Subtle Playback Progress Bar */}
          {progress > 0 && (
            <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-purple-500 transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
