import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  ChevronUp,
  ChevronDown,
  Flame,
  Tv,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Heart,
  Share2,
  Loader2,
  Download,
  Check,
} from "lucide-react";
import { extractYoutubeId, getThumbnail } from "@/lib/youtubeMeta";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { catLabel } from "@/lib/i18n-terms";
import {
  markVideoWatched,
  getAccountEmail,
  getVideoFavIds,
  setVideoFavIds,
} from "@/lib/activeUser";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import OfflineVideoNotice from "@/components/video/OfflineVideoNotice";
import {
  isVideoSavedOffline,
  getOfflineVideoBlobUrl,
  downloadVideoForOffline,
  removeVideoFromOffline,
} from "@/lib/offlineDB";

// Ensure YouTube IFrame API script is preloaded globally as early as possible
export function ensureYouTubeIframeApi() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.YT?.Player) return;
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  }
}

ensureYouTubeIframeApi();

// Helper to detect direct HTML5 video URLs (MP4 / WebM / M3U8 / Blob / Data)
function isDirectVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("data:video/") || trimmed.startsWith("blob:")) return true;
  if (/\.(mp4|webm|m3u8|mov)(\?.*)?$/i.test(trimmed)) return true;
  return false;
}

export default function ShortsPlayerModal({
  initialVideo,
  initialIndex: propInitialIndex,
  shortsList = [],
  channelsById = {},
  isOpen = true,
  onClose,
  user = null,
}) {
  const t = useT();
  const { isOnline } = useOnlineStatus();

  const list = useMemo(() => {
    if (shortsList.length > 0) {
      if (initialVideo?.id && !shortsList.some((v) => v.id === initialVideo.id)) {
        return [initialVideo, ...shortsList];
      }
      return shortsList;
    }
    return initialVideo ? [initialVideo] : [];
  }, [shortsList, initialVideo]);

  const resolvedStartIdx = useMemo(() => {
    if (typeof propInitialIndex === "number" && propInitialIndex >= 0 && propInitialIndex < list.length) {
      return propInitialIndex;
    }
    const found = list.findIndex((v) => v.id === initialVideo?.id);
    return found >= 0 ? found : 0;
  }, [propInitialIndex, list, initialVideo?.id]);

  const [currentIndex, setCurrentIndex] = useState(resolvedStartIdx);
  const [userPaused, setUserPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [ytEmbedError, setYtEmbedError] = useState(false);
  const [isSlideReady, setIsSlideReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [progress, setProgress] = useState(0);
  const [showHint, setShowHint] = useState(true);
  const [favIds, setFavIds] = useState(() => getVideoFavIds(getAccountEmail(user)));
  const [offlineBlobUrl, setOfflineBlobUrl] = useState(null);
  const [serverFallbackStreamUrl, setServerFallbackStreamUrl] = useState(null);
  const [isSavedOffline, setIsSavedOffline] = useState(false);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [offlineDownloadPct, setOfflineDownloadPct] = useState(0);

  const currentIndexRef = useRef(currentIndex);
  const currentVideoIdRef = useRef(initialVideo?.id || null);
  const listRef = useRef(list);
  const userPausedRef = useRef(false);
  const isMutedRef = useRef(false);
  const activeNativeVideoRef = useRef(null);
  const deckRef = useRef(null);
  const scrubbingRef = useRef(false);

  // Persistent YT.Player refs so swiping between Shorts reuses the warm player in <150ms
  const ytHostRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const loadedVidIdRef = useRef(null);
  const autoplayGuardTimerRef = useRef(null);
  const autoplayInnerTimerRef = useRef(null);
  const watchdogTimerRef = useRef(null);
  const fallbackRevealTimerRef = useRef(null);
  const slideAnimTimerRef = useRef(null);

  currentIndexRef.current = currentIndex;
  listRef.current = list;
  isMutedRef.current = isMuted;

  const currentVideo = list[currentIndex] || list[0] || initialVideo;
  if (currentVideo?.id) {
    currentVideoIdRef.current = currentVideo.id;
  }

  const rawUrl = currentVideo?.youtube_url || currentVideo?.file_url || "";
  const activeVidId = extractYoutubeId(rawUrl);
  const effectiveDirectUrl =
    offlineBlobUrl ||
    serverFallbackStreamUrl ||
    (!activeVidId && isDirectVideoUrl(rawUrl) ? rawUrl : null);
  const isDirectFile = Boolean(effectiveDirectUrl);
  const activePosterUrl =
    currentVideo?.thumbnail || (activeVidId ? getThumbnail(rawUrl) : "");

  const currentChannel = currentVideo?.channel_id
    ? channelsById[currentVideo.channel_id]
    : null;
  const channelLogo = currentChannel?.channel_logo || currentVideo?.channel_logo || "";
  const channelName = currentChannel?.name || currentVideo?.channel_name || "";
  const isFav = Boolean(currentVideo?.id && favIds.includes(currentVideo.id));

  // Keep currentIndex anchored to currentVideoId if shortsList refreshes in the background
  useEffect(() => {
    if (!isOpen || !currentVideoIdRef.current || list.length === 0) return;
    const activeItem = list[currentIndex];
    if (activeItem?.id === currentVideoIdRef.current) return;
    const foundIdx = list.findIndex((v) => v.id === currentVideoIdRef.current);
    if (foundIdx >= 0 && foundIdx !== currentIndex) {
      currentIndexRef.current = foundIdx;
      setCurrentIndex(foundIdx);
    }
  }, [isOpen, list, currentIndex]);

  // Sync favorite IDs when modal opens or user changes
  useEffect(() => {
    if (!isOpen) return;
    setFavIds(getVideoFavIds(getAccountEmail(user)));
  }, [isOpen, user]);

  // Check if current Short is saved in IndexedDB for offline playback
  useEffect(() => {
    let active = true;
    let createdBlobUrl = null;
    setOfflineBlobUrl(null);
    setServerFallbackStreamUrl(null);
    setIsSavedOffline(false);

    if (!isOpen || !currentVideo?.id) return;

    const loadOfflineState = async () => {
      const saved = Boolean(await Promise.resolve(isVideoSavedOffline(currentVideo.id)));
      if (!active) return;
      setIsSavedOffline(saved);
      if (saved) {
        const res = await getOfflineVideoBlobUrl(currentVideo.id);
        const bUrl = res?.blobUrl || (typeof res === "string" ? res : null);
        if (!active) {
          if (bUrl) {
            try {
              URL.revokeObjectURL(bUrl);
            } catch {}
          }
          return;
        }
        if (bUrl) {
          createdBlobUrl = bUrl;
          setOfflineBlobUrl(bUrl);
          setIsSlideReady(true);
          setIsBuffering(false);
        }
      }
    };

    loadOfflineState();

    const onSync = () => {
      if (currentVideo?.id && active) {
        setIsSavedOffline(Boolean(isVideoSavedOffline(currentVideo.id)));
      }
    };
    window.addEventListener("dau:offline-videos-changed", onSync);

    return () => {
      active = false;
      window.removeEventListener("dau:offline-videos-changed", onSync);
      if (createdBlobUrl) {
        try {
          URL.revokeObjectURL(createdBlobUrl);
        } catch {}
      }
    };
  }, [isOpen, currentVideo?.id]);

  // Automatic server-side MP4 stream fallback when YouTube IFrame reports embed error
  useEffect(() => {
    if (!isOpen || !activeVidId || !ytEmbedError || offlineBlobUrl) return;
    let cancelled = false;
    fetch(`/api/youtube-stream?id=${encodeURIComponent(activeVidId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const resolvedUrl =
          data?.proxyUrl ||
          (data?.url
            ? `/api/youtube-download?url=${encodeURIComponent(data.url)}`
            : null);
        if (resolvedUrl) {
          setServerFallbackStreamUrl(resolvedUrl);
          setIsSlideReady(true);
          setIsBuffering(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeVidId, ytEmbedError, offlineBlobUrl]);

  // Hide mobile bottom-nav while ShortsPlayerModal is open, restore on close
  useEffect(() => {
    if (!isOpen) {
      setIsSlideReady(false);
      setIsBuffering(false);
      setProgress(0);
      return;
    }
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
    };
  }, [isOpen]);

  // Sync index when modal opens or initialVideo ID / propInitialIndex changes
  useEffect(() => {
    if (!isOpen) return;
    let targetIdx = 0;
    if (typeof propInitialIndex === "number" && propInitialIndex >= 0 && propInitialIndex < listRef.current.length) {
      targetIdx = propInitialIndex;
    } else if (initialVideo?.id) {
      const idx = listRef.current.findIndex((v) => v.id === initialVideo.id);
      targetIdx = idx >= 0 ? idx : 0;
    } else {
      return;
    }
    const targetItem = listRef.current[targetIdx];
    currentVideoIdRef.current = targetItem?.id || initialVideo?.id || null;
    currentIndexRef.current = targetIdx;
    setCurrentIndex(targetIdx);
    userPausedRef.current = false;
    setUserPaused(false);
    setYtEmbedError(false);
    setIsSlideReady(false);
    setIsBuffering(true);
    setProgress(0);
    if (deckRef.current) {
      deckRef.current.style.transition = "none";
      deckRef.current.style.transform = "translate3d(0, 0px, 0)";
    }
  }, [isOpen, initialVideo?.id, propInitialIndex]);

  // Preload thumbnails for adjacent Shorts (including wrap-around) so swipes never flash empty frame
  useEffect(() => {
    if (!isOpen || list.length === 0) return;
    const len = list.length;
    const prevIdx = currentIndex > 0 ? currentIndex - 1 : len > 1 ? len - 1 : 0;
    const nextIdx = currentIndex < len - 1 ? currentIndex + 1 : len > 1 ? 0 : 0;
    [prevIdx, currentIndex, nextIdx].forEach((i) => {
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

  // Show swipe hint once when modal opens, hide after 2.2 seconds
  useEffect(() => {
    if (!isOpen) return;
    setShowHint(true);
    const timer = setTimeout(() => setShowHint(false), 2200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Autoplay guard helper: ensures video plays even if browser policy requires initial mute
  const triggerPlayWithAutoplayGuard = useCallback((player) => {
    if (!player) return;
    clearTimeout(autoplayGuardTimerRef.current);
    clearTimeout(autoplayInnerTimerRef.current);
    try {
      if (isMutedRef.current) {
        player.mute?.();
      } else {
        player.unMute?.();
        player.setVolume?.(100);
      }
      player.playVideo?.();
    } catch {}

    autoplayGuardTimerRef.current = setTimeout(() => {
      if (userPausedRef.current) return;
      try {
        const st = player.getPlayerState?.();
        // -1 = UNSTARTED, 5 = CUED, 2 = PAUSED
        if (st === -1 || st === 5 || st === 2) {
          player.playVideo?.();
          autoplayInnerTimerRef.current = setTimeout(() => {
            if (userPausedRef.current) return;
            try {
              const st2 = player.getPlayerState?.();
              if (st2 === -1 || st2 === 5 || st2 === 2) {
                // Browser blocked unmuted autoplay -> fallback to muted autoplay immediately
                player.mute?.();
                isMutedRef.current = true;
                setIsMuted(true);
                player.playVideo?.();
              }
            } catch {}
          }, 260);
        }
      } catch {}
    }, 300);
  }, []);

  // Initialize or reuse persistent YT.Player instance for instant Shorts playback
  useEffect(() => {
    if (!isOpen || !isOnline || !activeVidId || isDirectFile) return;

    setProgress(0);
    setYtEmbedError(false);
    setIsSlideReady(false);
    setIsBuffering(true);
    userPausedRef.current = false;
    setUserPaused(false);

    let cancelled = false;
    let pollInterval = null;
    clearTimeout(watchdogTimerRef.current);
    clearTimeout(fallbackRevealTimerRef.current);

    // Anti-hang guarantee: reveal the video iframe within 1100ms even if YouTube iframe postMessage is delayed
    fallbackRevealTimerRef.current = setTimeout(() => {
      if (!cancelled) {
        setIsSlideReady(true);
        setIsBuffering(false);
      }
    }, 1100);

    const destroyExistingPlayer = () => {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy?.();
        } catch {}
        ytPlayerRef.current = null;
      }
      ytReadyRef.current = false;
      loadedVidIdRef.current = null;
    };

    const createFreshPlayer = () => {
      if (cancelled || !ytHostRef.current) return;
      const YT = /** @type {any} */ (window).YT;
      if (!YT?.Player) return;

      destroyExistingPlayer();

      ytHostRef.current.innerHTML = "";
      const mountNode = document.createElement("div");
      mountNode.className = "w-full h-full pointer-events-none";
      ytHostRef.current.appendChild(mountNode);
      loadedVidIdRef.current = activeVidId;

      ytPlayerRef.current = new YT.Player(mountNode, {
        videoId: activeVidId,
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
          enablejsapi: 1,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            ytReadyRef.current = true;
            setIsSlideReady(true);
            setIsBuffering(false);
            try {
              e.target.setPlaybackRate?.(playbackSpeed);
            } catch {}
            triggerPlayWithAutoplayGuard(e.target);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            const state = e.data;
            // 1 = PLAYING
            if (state === 1) {
              clearTimeout(watchdogTimerRef.current);
              clearTimeout(fallbackRevealTimerRef.current);
              setYtEmbedError(false);
              setIsSlideReady(true);
              setIsBuffering(false);
              userPausedRef.current = false;
              setUserPaused(false);
            } else if (state === 3) {
              // 3 = BUFFERING
              setIsBuffering(true);
            } else if (state === 2) {
              // 2 = PAUSED
              setIsSlideReady(true);
              setIsBuffering(false);
            } else if (state === 5) {
              // 5 = VIDEO CUED
              setIsSlideReady(true);
              setIsBuffering(false);
              if (!userPausedRef.current) {
                triggerPlayWithAutoplayGuard(e.target);
              }
            } else if (state === 0) {
              // 0 = ENDED -> Seamless loop
              try {
                e.target.seekTo(0, true);
                e.target.playVideo();
              } catch {}
            }
          },
          onError: () => {
            if (cancelled) return;
            clearTimeout(watchdogTimerRef.current);
            clearTimeout(fallbackRevealTimerRef.current);
            setYtEmbedError(true);
            setIsBuffering(false);
            setIsSlideReady(true);
          },
        },
      });
    };

    const loadOrCreatePlayer = () => {
      if (cancelled || !ytHostRef.current) return;
      const YT = /** @type {any} */ (window).YT;
      if (!YT?.Player) return;

      const existingPlayer = ytPlayerRef.current;
      const existingIframe = existingPlayer?.getIframe?.();
      const isConnected = Boolean(
        existingIframe &&
          existingIframe.isConnected &&
          ytHostRef.current.contains(existingIframe)
      );

      // Fast path: Reuse warm, connected YT.Player instance via loadVideoById (<150ms!)
      if (
        existingPlayer &&
        ytReadyRef.current &&
        isConnected &&
        typeof existingPlayer.loadVideoById === "function"
      ) {
        try {
          if (loadedVidIdRef.current !== activeVidId) {
            loadedVidIdRef.current = activeVidId;
            existingPlayer.loadVideoById({
              videoId: activeVidId,
              startSeconds: 0,
            });
          }
          triggerPlayWithAutoplayGuard(existingPlayer);

          // Watchdog: if loadVideoById stalls for >2.2s without advancing or playing, recreate fresh
          watchdogTimerRef.current = setTimeout(() => {
            if (cancelled || userPausedRef.current) return;
            try {
              const p = ytPlayerRef.current;
              const st = p?.getPlayerState?.();
              const cur = Number(p?.getCurrentTime?.() || 0);
              if (st !== 1 && cur < 0.05) {
                createFreshPlayer();
              }
            } catch {
              createFreshPlayer();
            }
          }, 2200);
          return;
        } catch {
          // Fall through to createFreshPlayer
        }
      }

      createFreshPlayer();
    };

    ensureYouTubeIframeApi();
    if (/** @type {any} */ (window).YT?.Player) {
      loadOrCreatePlayer();
    } else {
      pollInterval = setInterval(() => {
        if (/** @type {any} */ (window).YT?.Player) {
          clearInterval(pollInterval);
          pollInterval = null;
          loadOrCreatePlayer();
        }
      }, 60);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(autoplayGuardTimerRef.current);
      clearTimeout(autoplayInnerTimerRef.current);
      clearTimeout(watchdogTimerRef.current);
      clearTimeout(fallbackRevealTimerRef.current);
    };
  }, [isOpen, isOnline, activeVidId, isDirectFile, triggerPlayWithAutoplayGuard]);

  // Destroy YT.Player only when the modal closes completely
  useEffect(() => {
    if (isOpen) return;
    clearTimeout(autoplayGuardTimerRef.current);
    clearTimeout(autoplayInnerTimerRef.current);
    clearTimeout(watchdogTimerRef.current);
    clearTimeout(fallbackRevealTimerRef.current);
    clearTimeout(slideAnimTimerRef.current);
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.destroy?.();
      } catch {}
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
      loadedVidIdRef.current = null;
    }
  }, [isOpen]);

  // Poll playback progress every 180ms while open
  useEffect(() => {
    if (!isOpen || isDirectFile) return;
    const interval = setInterval(() => {
      if (scrubbingRef.current) return;
      const player = ytPlayerRef.current;
      if (!player || !ytReadyRef.current) return;
      try {
        const cur = Number(player.getCurrentTime?.() || 0);
        const dur = Number(player.getDuration?.() || 0);
        const st = player.getPlayerState?.();
        if (cur > 0.04 || st === 1) {
          setIsSlideReady(true);
          if (st === 1) setIsBuffering(false);
        }
        if (dur > 0 && cur >= 0) {
          setProgress(Math.min(100, (cur / dur) * 100));
        }
      } catch {}
    }, 180);
    return () => clearInterval(interval);
  }, [isOpen, isDirectFile]);

  const switchToIndex = useCallback(
    (nextIdx, direction = "next") => {
      const items = listRef.current;
      if (nextIdx < 0 || nextIdx >= items.length) return;
      if (currentIndexRef.current === nextIdx) return;

      clearTimeout(slideAnimTimerRef.current);
      userPausedRef.current = false;
      setUserPaused(false);
      setProgress(0);
      setIsSlideReady(false);
      setIsBuffering(true);
      currentIndexRef.current = nextIdx;
      const targetVideo = items[nextIdx];
      if (targetVideo?.id) {
        currentVideoIdRef.current = targetVideo.id;
      }

      // Synchronously trigger loadVideoById inside the user gesture handler so mobile browsers
      // preserve the user-gesture activation token for instant unmuted playback
      const targetUrl = targetVideo?.youtube_url || targetVideo?.file_url || "";
      const nextVidId = extractYoutubeId(targetUrl);
      const existingPlayer = ytPlayerRef.current;
      if (
        nextVidId &&
        existingPlayer &&
        ytReadyRef.current &&
        typeof existingPlayer.loadVideoById === "function"
      ) {
        try {
          loadedVidIdRef.current = nextVidId;
          existingPlayer.loadVideoById({
            videoId: nextVidId,
            startSeconds: 0,
          });
          triggerPlayWithAutoplayGuard(existingPlayer);
        } catch {}
      }

      setCurrentIndex(nextIdx);

      // Smoothly animate the new slide coming in from bottom ("next") or top ("prev")
      const deck = deckRef.current;
      if (deck) {
        const startOffset = direction === "prev" ? "-22%" : "22%";
        deck.style.transition = "none";
        deck.style.transform = `translate3d(0, ${startOffset}, 0)`;
        // Force reflow so browser registers starting offset
        void deck.offsetHeight;
        deck.style.transition = "transform 210ms cubic-bezier(0.22, 1, 0.36, 1)";
        deck.style.transform = "translate3d(0, 0px, 0)";
      }
    },
    [triggerPlayWithAutoplayGuard]
  );

  // Single tap on screen or Play/Pause button: instant Pause / Resume
  const togglePlayPause = useCallback((e) => {
    if (e) e.stopPropagation();
    const nextPaused = !userPausedRef.current;
    userPausedRef.current = nextPaused;
    setUserPaused(nextPaused);

    const nativeEl = activeNativeVideoRef.current;
    if (nativeEl) {
      try {
        if (nextPaused) {
          nativeEl.pause();
        } else {
          nativeEl.muted = isMutedRef.current;
          nativeEl.play().catch(() => {});
        }
      } catch {}
    }

    const player = ytPlayerRef.current;
    if (player && ytReadyRef.current) {
      try {
        if (nextPaused) {
          player.pauseVideo?.();
        } else {
          if (isMutedRef.current) {
            player.mute?.();
          } else {
            player.unMute?.();
            player.setVolume?.(100);
          }
          player.playVideo?.();
        }
      } catch {}
    }
  }, []);

  const toggleMute = useCallback((e) => {
    if (e) e.stopPropagation();
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);

    const nativeEl = activeNativeVideoRef.current;
    if (nativeEl) {
      nativeEl.muted = nextMuted;
    }

    const player = ytPlayerRef.current;
    if (player && ytReadyRef.current) {
      try {
        if (nextMuted) {
          player.mute?.();
        } else {
          player.unMute?.();
          player.setVolume?.(100);
          if (!userPausedRef.current) {
            player.playVideo?.();
          }
        }
      } catch {}
    }
  }, []);

  const handleToggleFav = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      if (!currentVideo?.id) return;
      const email = getAccountEmail(user);
      const currentList = getVideoFavIds(email);
      const exists = currentList.includes(currentVideo.id);
      const updated = exists
        ? currentList.filter((id) => id !== currentVideo.id)
        : [...currentList, currentVideo.id];
      setVideoFavIds(email, updated);
      setFavIds(updated);
      toast.success(
        exists
          ? t.removeFav || "تمت الإزالة من المفضلة"
          : t.addFav || "تمت الإضافة إلى المفضلة ✓"
      );
    },
    [currentVideo?.id, user, t.removeFav, t.addFav]
  );

  const handleShare = useCallback(
    async (e) => {
      if (e) e.stopPropagation();
      if (!currentVideo) return;
      const shareUrl = currentVideo.youtube_url || window.location.href;
      try {
        if (navigator.share) {
          await navigator.share({
            title: currentVideo.title || "DAR AL TAWHID",
            url: shareUrl,
          });
          return;
        }
      } catch {}
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t.linkCopied || "تم نسخ الرابط");
      } catch {}
    },
    [currentVideo, t.linkCopied]
  );

  const handleToggleOfflineDownload = useCallback(
    async (e) => {
      if (e) e.stopPropagation();
      if (!currentVideo?.id || isDownloadingOffline) return;

      if (isSavedOffline) {
        await removeVideoFromOffline(currentVideo.id);
        setIsSavedOffline(false);
        if (offlineBlobUrl) {
          try {
            URL.revokeObjectURL(offlineBlobUrl);
          } catch {}
          setOfflineBlobUrl(null);
        }
        toast.info(
          t.removedOfflineVideo || "تم حذف المقطع من المشاهدة بلا نت"
        );
        return;
      }

      setIsDownloadingOffline(true);
      setOfflineDownloadPct(1);
      try {
        await downloadVideoForOffline(currentVideo, (pct) => {
          setOfflineDownloadPct(pct);
        });
        setIsSavedOffline(true);
        const res = await getOfflineVideoBlobUrl(currentVideo.id);
        const bUrl = res?.blobUrl || (typeof res === "string" ? res : null);
        if (bUrl) setOfflineBlobUrl(bUrl);
        toast.success(
          t.savedVideoOfflineSuccess ||
            "تم تحميل المقطع للمشاهدة بلا إنترنت ✓"
        );
      } catch (err) {
        toast.error(err?.message || "تعذر تحميل المقطع للمشاهدة بلا نت");
      } finally {
        setIsDownloadingOffline(false);
        setOfflineDownloadPct(0);
      }
    },
    [
      currentVideo,
      isDownloadingOffline,
      isSavedOffline,
      offlineBlobUrl,
      t.removedOfflineVideo,
      t.savedVideoOfflineSuccess,
    ]
  );

  const goToNext = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      const idx = currentIndexRef.current;
      const len = listRef.current.length;
      if (idx < len - 1) {
        switchToIndex(idx + 1, "next");
      } else if (len > 1) {
        switchToIndex(0, "next");
      } else {
        toast.info(t.reachedLastShort || "وصلت إلى آخر مقطع قصير");
      }
    },
    [switchToIndex, t.reachedLastShort]
  );

  const goToPrev = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      const idx = currentIndexRef.current;
      const len = listRef.current.length;
      if (idx > 0) {
        switchToIndex(idx - 1, "prev");
      } else if (len > 1) {
        switchToIndex(len - 1, "prev");
      }
    },
    [switchToIndex]
  );

  // Seek within current Short via bottom interactive progress bar
  const seekShortToRatio = useCallback(
    (ratio) => {
      const clamped = Math.min(1, Math.max(0, ratio));
      setProgress(clamped * 100);

      if (isDirectFile && activeNativeVideoRef.current) {
        const el = activeNativeVideoRef.current;
        if (el.duration > 0) {
          el.currentTime = clamped * el.duration;
        }
        return;
      }

      const player = ytPlayerRef.current;
      if (player && ytReadyRef.current) {
        try {
          const dur = Number(player.getDuration?.() || 0);
          if (dur > 0) {
            player.seekTo?.(clamped * dur, true);
          }
        } catch {}
      }
    },
    [isDirectFile]
  );

  // Keyboard navigation
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
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToNext, goToPrev, onClose, togglePlayPause, toggleMute]);

  // Throttled mouse wheel scroll navigation
  const wheelLockRef = useRef(false);
  const handleWheel = useCallback(
    (e) => {
      if (wheelLockRef.current || listRef.current.length <= 1) return;
      if (Math.abs(e.deltaY) > 22) {
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

  // Unified Pointer Events swipe & tap gesture engine (works identically on mobile touch & desktop mouse)
  const pointerIdRef = useRef(null);
  const dragStartY = useRef(null);
  const dragStartX = useRef(null);
  const dragStartTime = useRef(0);

  const handlePointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    dragStartY.current = e.clientY;
    dragStartX.current = e.clientX;
    dragStartTime.current = Date.now();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (deckRef.current) {
      deckRef.current.style.transition = "none";
    }
  };

  const handlePointerMove = (e) => {
    if (pointerIdRef.current !== e.pointerId || dragStartY.current === null || !deckRef.current) {
      return;
    }
    const dy = e.clientY - dragStartY.current;
    const dx = dragStartX.current !== null ? Math.abs(e.clientX - dragStartX.current) : 0;
    if (Math.abs(dy) > 8 && Math.abs(dy) > dx * 0.85) {
      const canDrag = listRef.current.length > 1;
      const factor = canDrag ? 0.72 : 0.2;
      const maxOffset = canDrag ? 220 : 40;
      const damped = Math.max(-maxOffset, Math.min(maxOffset, dy * factor));
      deckRef.current.style.transform = `translate3d(0, ${damped}px, 0)`;
    }
  };

  const finishPointerGesture = (e, cancelled = false) => {
    if (pointerIdRef.current !== e.pointerId || dragStartY.current === null) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const deltaY = e.clientY - dragStartY.current;
    const deltaX = dragStartX.current !== null ? Math.abs(e.clientX - dragStartX.current) : 0;
    const elapsed = Math.max(1, Date.now() - dragStartTime.current);
    const velocityY = Math.abs(deltaY) / elapsed; // px per ms

    pointerIdRef.current = null;
    dragStartY.current = null;
    dragStartX.current = null;

    if (!cancelled) {
      // Trigger swipe if dragged >= 34px vertically OR fast flick >= 18px with velocity > 0.25 px/ms
      const isSwipe =
        Math.abs(deltaY) > deltaX &&
        (Math.abs(deltaY) >= 34 || (Math.abs(deltaY) >= 18 && velocityY > 0.25));

      if (isSwipe && listRef.current.length > 0) {
        if (deltaY < 0) {
          goToNext();
          return;
        } else if (deltaY > 0) {
          goToPrev();
          return;
        }
      } else if (Math.abs(deltaY) < 14 && deltaX < 14 && elapsed < 550) {
        togglePlayPause();
      }
    }

    if (deckRef.current) {
      deckRef.current.style.transition = "transform 180ms ease-out";
      deckRef.current.style.transform = "translate3d(0, 0px, 0)";
    }
  };

  if (!isOpen || !currentVideo) return null;

  if (!isOnline && !isDirectFile) {
    return <OfflineVideoNotice video={currentVideo} onClose={onClose} />;
  }

  const len = list.length;
  const prevIdx = currentIndex > 0 ? currentIndex - 1 : len > 1 ? len - 1 : -1;
  const nextIdx = currentIndex < len - 1 ? currentIndex + 1 : len > 1 ? 0 : -1;
  const prevSlideVideo = prevIdx >= 0 ? list[prevIdx] : null;
  const nextSlideVideo = nextIdx >= 0 ? list[nextIdx] : null;
  const prevPoster =
    prevSlideVideo?.thumbnail || getThumbnail(prevSlideVideo?.youtube_url);
  const nextPoster =
    nextSlideVideo?.thumbnail || getThumbnail(nextSlideVideo?.youtube_url);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black sm:bg-black/95 flex items-center justify-center p-0 sm:p-4 select-none overflow-hidden"
      style={{ height: "100dvh", touchAction: "none" }}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
      dir={t.dir || "rtl"}
    >
      {/* Main Responsive 9:16 Shorts Container */}
      <div className="relative w-full h-full sm:h-[90dvh] sm:w-auto sm:aspect-[9/16] max-w-full sm:rounded-3xl overflow-hidden bg-black shadow-2xl flex flex-col justify-between sm:border sm:border-white/15">
        {/* Video Deck (Notice: NO overflow-hidden here so -100% and +100% adjacent slides are visible while dragging!) */}
        <div
          ref={deckRef}
          className="absolute inset-0 z-0 bg-black will-change-transform"
        >
          {/* Previous Slide Poster Preview (Above) */}
          {prevSlideVideo && (
            <div
              className="absolute inset-0 w-full h-full bg-black overflow-hidden pointer-events-none"
              style={{ transform: "translate3d(0, -100%, 0)" }}
            >
              {prevPoster && (
                <img
                  src={prevPoster}
                  alt={prevSlideVideo.title || ""}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/25" />
            </div>
          )}

          {/* Active Slide with Persistent YT.Player or Direct Video */}
          <div className="absolute inset-0 w-full h-full bg-black overflow-hidden z-[2]">
            {isDirectFile ? (
              <video
                ref={(el) => {
                  activeNativeVideoRef.current = el;
                }}
                src={effectiveDirectUrl}
                poster={activePosterUrl}
                playsInline
                autoPlay
                muted={isMuted}
                loop
                preload="auto"
                className="w-full h-full object-cover pointer-events-none select-none"
                onLoadedData={() => {
                  setIsSlideReady(true);
                  setIsBuffering(false);
                }}
                onPlaying={() => {
                  setIsSlideReady(true);
                  setIsBuffering(false);
                }}
                onWaiting={() => setIsBuffering(true)}
                onTimeUpdate={(e) => {
                  if (scrubbingRef.current) return;
                  const el = e.currentTarget;
                  if (el.duration > 0) {
                    setProgress((el.currentTime / el.duration) * 100);
                  }
                }}
              />
            ) : activeVidId ? (
              <>
                <div
                  ref={ytHostRef}
                  className="w-full h-[128%] -my-[14%] pointer-events-none select-none overflow-hidden"
                />
                {ytEmbedError && (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${activeVidId}?autoplay=1&loop=1&playlist=${activeVidId}&playsinline=1&rel=0&modestbranding=1`}
                    title={currentVideo?.title || "Short"}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    className="absolute inset-0 w-full h-full border-0 z-[5]"
                  />
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

            {/* Poster Cover until first playing frame arrives */}
            {!isSlideReady && activePosterUrl && (
              <div className="absolute inset-0 z-[3] bg-black pointer-events-none overflow-hidden">
                <img
                  src={activePosterUrl}
                  alt={currentVideo?.title || ""}
                  className={`w-full h-full object-cover ${
                    activePosterUrl.includes("hqdefault") ? "scale-[1.35]" : ""
                  }`}
                />
                <div className="absolute inset-0 bg-black/25" />
              </div>
            )}

            {/* Subtle Loading Spinner while buffering */}
            {(!isSlideReady || isBuffering) && !userPaused && (
              <div className="absolute inset-0 z-[4] flex items-center justify-center pointer-events-none">
                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Next Slide Poster Preview (Below) */}
          {nextSlideVideo && (
            <div
              className="absolute inset-0 w-full h-full bg-black overflow-hidden pointer-events-none"
              style={{ transform: "translate3d(0, 100%, 0)" }}
            >
              {nextPoster && (
                <img
                  src={nextPoster}
                  alt={nextSlideVideo.title || ""}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/25" />
            </div>
          )}

          {/* Play indicator when explicitly paused by user tap */}
          {userPaused && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/65 text-white flex items-center justify-center shadow-2xl ring-2 ring-white/30">
                <Play className="w-7 h-7 fill-current ml-0.5" />
              </div>
            </div>
          )}

          {/* Protective Pointer/Swipe Shield: Captures vertical swipe up/down & single tap to pause/resume */}
          <div
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => finishPointerGesture(e, false)}
            onPointerCancel={(e) => finishPointerGesture(e, true)}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        {/* Top Bar: Shorts badge, Unmute quick-pill if muted, & Close button */}
        <div className="relative z-30 p-3.5 sm:p-4 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/35 to-transparent">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-600/90 text-white shadow-md flex items-center justify-center border border-white/15">
              <Flame className="w-4 h-4 fill-current" />
            </span>
            <span className="text-xs font-bold text-white/95 drop-shadow">
              {t.shortsBadge || "شورتس"}
            </span>
            {list.length > 1 && (
              <span className="text-[11px] font-mono text-white/75 bg-white/15 px-2 py-0.5 rounded-full">
                {currentIndex + 1} / {list.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isMuted && (
              <button
                type="button"
                onClick={toggleMute}
                className="px-3 py-1.5 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg animate-pulse"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>{t.unmute || "تشغيل الصوت"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="w-9 h-9 rounded-full bg-black/65 hover:bg-black/85 text-white flex items-center justify-center transition-colors border border-white/20 shadow-lg active:scale-95"
              title={t.close || "إغلاق"}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Floating Side Action Controls */}
        <div className="absolute bottom-28 end-3 z-30 flex flex-col items-center gap-3">
          {/* Play / Pause Button */}
          <button
            type="button"
            onClick={togglePlayPause}
            title={userPaused ? t.playNow || "تشغيل" : t.pause || "إيقاف مؤقت"}
            className="w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow-lg active:scale-90 transition-all"
          >
            {userPaused ? (
              <Play className="w-5 h-5 fill-current" />
            ) : (
              <Pause className="w-5 h-5" />
            )}
          </button>

          {/* Mute / Unmute Button */}
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? t.unmute || "تشغيل الصوت" : t.mute || "كتم الصوت"}
            className="w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow-lg active:scale-90 transition-all"
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 text-rose-400" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>

          {/* Playback Speed Button (1x / 1.25x / 1.5x / 2x) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const speeds = [1, 1.25, 1.5, 2];
              const nextSpeed = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
              setPlaybackSpeed(nextSpeed);
              if (activeNativeVideoRef.current) {
                activeNativeVideoRef.current.playbackRate = nextSpeed;
              }
              try {
                ytPlayerRef.current?.setPlaybackRate?.(nextSpeed);
              } catch {}
            }}
            title={t.speedLabel || "السرعة"}
            className="w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow-lg active:scale-90 transition-all text-[11px] font-mono font-bold"
          >
            {playbackSpeed}x
          </button>

          {/* Favorite / Like Button */}
          <button
            type="button"
            onClick={handleToggleFav}
            title={t.likeOrFavorite || "إضافة للمفضلة"}
            className={`w-11 h-11 rounded-full border flex items-center justify-center shadow-lg active:scale-90 transition-all ${
              isFav
                ? "bg-rose-500/90 border-rose-400 text-white"
                : "bg-black/65 hover:bg-black/85 border-white/20 text-white"
            }`}
          >
            <Heart className={`w-5 h-5 ${isFav ? "fill-current" : ""}`} />
          </button>

          {/* Offline Download Button */}
          <button
            type="button"
            onClick={handleToggleOfflineDownload}
            disabled={isDownloadingOffline}
            title={
              isSavedOffline
                ? t.removeOfflineVideoTip || "محفوظ للمشاهدة بلا نت (اضغط للإزالة)"
                : t.downloadOfflineVideoTip || "تحميل لمشاهدته بلا إنترنت"
            }
            className={`w-11 h-11 rounded-full border flex flex-col items-center justify-center shadow-lg active:scale-90 transition-all ${
              isSavedOffline
                ? "bg-emerald-600 border-emerald-400 text-white"
                : isDownloadingOffline
                ? "bg-purple-600 border-purple-400 text-white"
                : "bg-black/65 hover:bg-black/85 border-white/20 text-white"
            }`}
          >
            {isDownloadingOffline ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[9px] font-mono font-bold leading-none mt-0.5">
                  {offlineDownloadPct}%
                </span>
              </>
            ) : isSavedOffline ? (
              <Check className="w-5 h-5" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </button>

          {/* Share Button */}
          <button
            type="button"
            onClick={handleShare}
            title={t.share || "مشاركة"}
            className="w-11 h-11 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow-lg active:scale-90 transition-all"
          >
            <Share2 className="w-5 h-5" />
          </button>

          {/* Up / Down Navigation Buttons */}
          {list.length > 1 && (
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={goToPrev}
                title={t.prevShortTip || "المقطع السابق"}
                className="w-9 h-9 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow active:scale-90 transition-all"
              >
                <ChevronUp className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goToNext}
                title={t.nextShortTip || "المقطع التالي"}
                className="w-9 h-9 rounded-full bg-black/65 hover:bg-black/85 text-white border border-white/20 flex items-center justify-center shadow active:scale-90 transition-all"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Bottom Overlay Info (Channel, Category, Title & Interactive Progress Scrubber) */}
        <div className="relative z-20 p-4 pb-4 pe-16 bg-gradient-to-t from-black/95 via-black/75 to-transparent text-white space-y-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-2">
            {channelName && (
              <div className="flex items-center gap-2">
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
            {currentVideo.category && (
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/30 border border-purple-400/30 text-[10px] font-semibold text-purple-100">
                {catLabel(currentVideo.category, t.langCode)}
              </span>
            )}
          </div>

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

          {/* Interactive Draggable Playback Progress Bar */}
          <div
            dir="ltr"
            style={{ touchAction: "none" }}
            className="w-full py-2 cursor-pointer pointer-events-auto group"
            onPointerDown={(e) => {
              e.stopPropagation();
              scrubbingRef.current = true;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width > 0) {
                seekShortToRatio((e.clientX - rect.left) / rect.width);
              }
            }}
            onPointerMove={(e) => {
              if (!scrubbingRef.current) return;
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width > 0) {
                seekShortToRatio((e.clientX - rect.left) / rect.width);
              }
            }}
            onPointerUp={(e) => {
              if (!scrubbingRef.current) return;
              e.stopPropagation();
              scrubbingRef.current = false;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {}
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width > 0) {
                seekShortToRatio((e.clientX - rect.left) / rect.width);
              }
            }}
            onPointerCancel={() => {
              scrubbingRef.current = false;
            }}
          >
            <div className="relative w-full h-1.5 group-hover:h-2 bg-white/25 rounded-full overflow-visible transition-all">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-75"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow ring-2 ring-purple-500"
                style={{ left: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
