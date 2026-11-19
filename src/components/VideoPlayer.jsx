import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Maximize, Minimize, Play, Pause, RotateCcw, Volume2, VolumeX,
  Share2, Rewind, FastForward, Repeat, SkipBack, SkipForward,
  ListVideo, Sun, HelpCircle, Gauge, Heart, Download, Check, Loader2, WifiOff
} from "lucide-react";
import { extractYoutubeId } from "@/lib/youtubeMeta";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { usePlayerGestures } from "@/hooks/usePlayerGestures";
import PlaylistPanel from "@/components/video/PlaylistPanel";
import PlayerButton from "@/components/video/PlayerButton";
import OfflineVideoNotice from "@/components/video/OfflineVideoNotice";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getAccountEmail, getVideoFavIds, setVideoFavIds } from "@/lib/activeUser";
import {
  isVideoSavedOffline,
  getOfflineVideoBlobUrl,
  downloadVideoForOffline,
  removeVideoFromOffline,
} from "@/lib/offlineDB";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isDirectVideoFile(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:video/")) return true;
  if (/\.(mp4|webm|m3u8|mov)(\?.*)?$/i.test(trimmed)) return true;
  return false;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export default function VideoPlayer({ video, onClose, playlist = [], onSelectVideo = undefined }) {
  const t = useT();
  const { isOnline } = useOnlineStatus();
  const containerRef = useRef(null);
  const playerHostRef = useRef(null);
  const nativeVideoRef = useRef(null);
  const playerInstanceRef = useRef(null);
  const hideTimerRef = useRef(null);
  const resumeGuardTimerRef = useRef(null);
  const barRef = useRef(null);

  const [player, setPlayer] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [ready, setReady] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [favIds, setFavIds] = useState(() => getVideoFavIds(getAccountEmail()));
  const [offlineBlobUrl, setOfflineBlobUrl] = useState(null);
  const [checkingOffline, setCheckingOffline] = useState(true);
  const [isOfflineSaved, setIsOfflineSaved] = useState(() => isVideoSavedOffline(video?.id));
  const [downloadingOffline, setDownloadingOffline] = useState(false);
  const [downloadPct, setDownloadPct] = useState(0);
  const tapToggleTimerRef = useRef(null);

  // Refs for synchronization without stale closures
  const loopRef = useRef(false);
  const playingRef = useRef(false);
  const mutedRef = useRef(false);
  const volumeRef = useRef(100);
  const userPausedRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const lastSeekAtRef = useRef(0);
  const lastPreviewSeekCallRef = useRef(0);
  const showPlaylistRef = useRef(false);
  const showSpeedMenuRef = useRef(false);
  const showShortcutsModalRef = useRef(false);

  playingRef.current = playing;
  mutedRef.current = muted;
  volumeRef.current = volume;
  showPlaylistRef.current = showPlaylist;
  showSpeedMenuRef.current = showSpeedMenu;
  showShortcutsModalRef.current = showShortcutsModal;

  // Auto-advance countdown state
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState(null);
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(5);

  const rawVideoUrl = video?.youtube_url || video?.file_url || "";
  const videoId = extractYoutubeId(rawVideoUrl);
  const directVideoSrc = offlineBlobUrl || (isDirectVideoFile(rawVideoUrl) ? rawVideoUrl : null);
  const usingNativeVideo = Boolean(directVideoSrc);
  const isFav = Boolean(video?.id && favIds.includes(video.id));
  const posKey = videoId || video?.id || "vid";

  // Check if video has a downloaded offline MP4 blob in IndexedDB
  useEffect(() => {
    let active = true;
    let createdBlobUrl = null;
    setCheckingOffline(true);
    setOfflineBlobUrl(null);
    setIsOfflineSaved(isVideoSavedOffline(video?.id));

    if (video?.id) {
      getOfflineVideoBlobUrl(video.id)
        .then((res) => {
          if (!active) {
            if (res?.blobUrl) URL.revokeObjectURL(res.blobUrl);
            return;
          }
          if (res?.blobUrl) {
            createdBlobUrl = res.blobUrl;
            setOfflineBlobUrl(res.blobUrl);
            setIsOfflineSaved(true);
          }
          setCheckingOffline(false);
        })
        .catch(() => {
          if (active) setCheckingOffline(false);
        });
    } else {
      setCheckingOffline(false);
    }

    return () => {
      active = false;
      if (createdBlobUrl) {
        try {
          URL.revokeObjectURL(createdBlobUrl);
        } catch {}
      }
    };
  }, [video?.id]);

  const handleToggleOfflineDownload = useCallback(
    async (e) => {
      if (e) e.stopPropagation();
      if (!video?.id || downloadingOffline) return;

      if (isOfflineSaved) {
        await removeVideoFromOffline(video.id);
        setIsOfflineSaved(false);
        setOfflineBlobUrl(null);
        toast.info(t.removedOfflineVideo || "تمت إزالة الفيديو من التنزيلات بلا نت");
        return;
      }

      setDownloadingOffline(true);
      setDownloadPct(5);
      try {
        const rec = await downloadVideoForOffline(video, (pct) => setDownloadPct(pct));
        setIsOfflineSaved(true);
        if (rec?.blob instanceof Blob && rec.blob.size > 0 && !offlineBlobUrl) {
          setOfflineBlobUrl(URL.createObjectURL(rec.blob));
        }
        toast.success(t.savedVideoOfflineSuccess || "تم تحميل الفيديو للمشاهدة بلا نت ✓");
      } catch {
        toast.error(t.downloadVideoFailed || "تعذر تحميل الفيديو حالياً، حاول مرة أخرى");
      } finally {
        setDownloadingOffline(false);
        setDownloadPct(0);
      }
    },
    [video, downloadingOffline, isOfflineSaved, offlineBlobUrl, t.removedOfflineVideo, t.savedVideoOfflineSuccess, t.downloadVideoFailed]
  );

  const handleToggleFav = useCallback(
    (e) => {
      if (e) e.stopPropagation();
      if (!video?.id) return;
      const email = getAccountEmail();
      const currentList = getVideoFavIds(email);
      const exists = currentList.includes(video.id);
      const updated = exists
        ? currentList.filter((id) => id !== video.id)
        : [...currentList, video.id];
      setVideoFavIds(email, updated);
      setFavIds(updated);
      toast.success(
        exists
          ? t.removeFav || "تمت الإزالة من المفضلة"
          : t.addFav || "تمت الإضافة إلى المفضلة ✓"
      );
    },
    [video?.id, t.removeFav, t.addFav]
  );

  // ── Playlist navigation ──
  const plIdx = playlist.findIndex((v) => v.id === video?.id);
  const nextItem = plIdx >= 0 && plIdx < playlist.length - 1 ? playlist[plIdx + 1] : null;
  const prevItem = plIdx > 0 ? playlist[plIdx - 1] : null;
  const nextItemRef = useRef(null);
  const onSelectVideoRef = useRef(null);
  nextItemRef.current = nextItem;
  onSelectVideoRef.current = onSelectVideo;

  const cancelAutoAdvance = useCallback(() => {
    setAutoAdvanceTimer(null);
    setAutoAdvanceSeconds(5);
  }, []);

  const playNextNow = useCallback(() => {
    if (nextItemRef.current && onSelectVideoRef.current) {
      onSelectVideoRef.current(nextItemRef.current);
    }
    cancelAutoAdvance();
  }, [cancelAutoAdvance]);

  // Handle auto-advance countdown
  useEffect(() => {
    if (autoAdvanceTimer === null) return;
    if (autoAdvanceSeconds <= 0) {
      if (nextItemRef.current && onSelectVideoRef.current) {
        onSelectVideoRef.current(nextItemRef.current);
      }
      setAutoAdvanceTimer(null);
      return;
    }
    const interval = setInterval(() => {
      setAutoAdvanceSeconds((s) => s - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [autoAdvanceTimer, autoAdvanceSeconds]);

  // ── Mode A: Native HTML5 Video Adapter (for offline downloaded videos & direct MP4 files) ──
  useEffect(() => {
    if (!usingNativeVideo || !directVideoSrc) return;
    const el = nativeVideoRef.current;
    if (!el) return;

    let savedStart = 0;
    try {
      const raw = Number(localStorage.getItem(`video_pos_${posKey}`) || 0);
      if (Number.isFinite(raw) && raw > 3) {
        savedStart = Math.floor(raw);
      }
    } catch {}

    const adapter = {
      playVideo: () => {
        el.play().catch(() => {
          el.muted = true;
          setMuted(true);
          mutedRef.current = true;
          el.play().catch(() => {});
        });
      },
      pauseVideo: () => el.pause(),
      seekTo: (sec) => {
        try {
          el.currentTime = Math.max(0, Number(sec) || 0);
        } catch {}
      },
      setPlaybackRate: (r) => {
        try {
          el.playbackRate = Number(r) || 1;
        } catch {}
      },
      mute: () => {
        el.muted = true;
      },
      unMute: () => {
        el.muted = false;
      },
      setVolume: (v) => {
        el.volume = Math.max(0, Math.min(1, (Number(v) || 0) / 100));
      },
      getVolume: () => Math.round((el.volume ?? 1) * 100),
      isMuted: () => Boolean(el.muted),
      getCurrentTime: () => Number(el.currentTime || 0),
      getDuration: () => Number(el.duration || 0),
      getVideoLoadedFraction: () => {
        try {
          if (el.buffered?.length > 0 && el.duration > 0) {
            return el.buffered.end(el.buffered.length - 1) / el.duration;
          }
        } catch {}
        return 0;
      },
      getPlayerState: () => {
        if (el.ended) return 0;
        if (el.paused) return 2;
        return 1;
      },
    };

    setPlayer(adapter);
    setReady(true);
    setBuffering(false);

    const onLoadedMeta = () => {
      const d = Number(el.duration || 0);
      if (d > 0) {
        setDuration(d);
        if (savedStart > 0 && savedStart < d - 5) {
          el.currentTime = savedStart;
          setCurrentTime(savedStart);
        }
      }
      setReady(true);
      adapter.playVideo();
    };

    const onPlay = () => {
      userPausedRef.current = false;
      playingRef.current = true;
      setPlaying(true);
      setBuffering(false);
      cancelAutoAdvance();
    };

    const onPause = () => {
      if (!el.ended) {
        playingRef.current = false;
        setPlaying(false);
        setBuffering(false);
      }
    };

    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setPlaying(true);
      playingRef.current = true;
    };

    const onEnded = () => {
      setBuffering(false);
      try {
        localStorage.removeItem(`video_pos_${posKey}`);
      } catch {}
      if (loopRef.current) {
        el.currentTime = 0;
        adapter.playVideo();
      } else {
        playingRef.current = false;
        setPlaying(false);
        if (nextItemRef.current) {
          setAutoAdvanceSeconds(5);
          setAutoAdvanceTimer(true);
        }
      }
    };

    el.addEventListener("loadedmetadata", onLoadedMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnded);

    if (el.readyState >= 1) {
      onLoadedMeta();
    }

    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnded);
    };
  }, [usingNativeVideo, directVideoSrc, posKey, cancelAutoAdvance]);

  // ── Mode B: Initialize YouTube IFrame API player cleanly per videoId (when not using native video) ──
  useEffect(() => {
    if (usingNativeVideo || checkingOffline) return;

    // Reset player states immediately on videoId change so polling never reads stale instance
    setPlayer(null);
    setReady(false);
    setPlaying(false);
    setBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedPct(0);
    setRate(1);
    playingRef.current = false;
    userPausedRef.current = false;
    isScrubbingRef.current = false;
    cancelAutoAdvance();

    if (!videoId || !isOnline) return;
    let cancelled = false;
    let fallbackReadyTimer = null;

    // Read saved resume position synchronously for this specific videoId
    let savedStart = 0;
    try {
      const raw = Number(localStorage.getItem(`video_pos_${videoId}`) || 0);
      if (Number.isFinite(raw) && raw > 3) {
        savedStart = Math.floor(raw);
      }
    } catch {}

    const initPlayer = () => {
      const YT = /** @type {any} */ (window).YT;
      if (cancelled || !YT?.Player || !playerHostRef.current) return;

      // Destroy any previous instance before mounting a fresh child node
      if (playerInstanceRef.current) {
        try {
          playerInstanceRef.current.destroy();
        } catch {}
        playerInstanceRef.current = null;
      }

      playerHostRef.current.innerHTML = "";
      const mountNode = document.createElement("div");
      mountNode.className = "w-full h-full pointer-events-none";
      playerHostRef.current.appendChild(mountNode);

      const inst = new YT.Player(mountNode, {
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
          enablejsapi: 1,
          start: savedStart > 0 ? savedStart : 0,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            clearTimeout(fallbackReadyTimer);
            const target = e.target;
            const dur = Number(target.getDuration?.() || 0);

            if (dur > 0 && savedStart >= dur - 5) {
              savedStart = 0;
              try {
                localStorage.removeItem(`video_pos_${videoId}`);
                target.seekTo(0, true);
              } catch {}
            } else if (savedStart > 0) {
              setCurrentTime(savedStart);
            }

            setPlayer(target);
            if (dur > 0) setDuration(dur);
            setReady(true);
            setBuffering(false);

            try {
              const initVol = target.getVolume?.();
              const initMuted = target.isMuted?.();
              if (typeof initVol === "number") {
                setVolume(initVol);
                volumeRef.current = initVol;
              }
              if (typeof initMuted === "boolean") {
                setMuted(initMuted);
                mutedRef.current = initMuted;
              }
            } catch {}

            try {
              target.playVideo();
            } catch {}

            // Autoplay guard: if browser blocks unmuted autoplay, fallback to muted autoplay
            clearTimeout(resumeGuardTimerRef.current);
            resumeGuardTimerRef.current = setTimeout(() => {
              if (cancelled || userPausedRef.current) return;
              try {
                const st = target.getPlayerState?.();
                if (st === -1 || st === 5 || st === 2) {
                  target.playVideo?.();
                  setTimeout(() => {
                    if (cancelled || userPausedRef.current) return;
                    const st2 = target.getPlayerState?.();
                    if (st2 === -1 || st2 === 5) {
                      target.mute?.();
                      setMuted(true);
                      mutedRef.current = true;
                      target.playVideo?.();
                    }
                  }, 320);
                }
              } catch {}
            }, 380);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            clearTimeout(fallbackReadyTimer);
            const YTState = /** @type {any} */ (window).YT?.PlayerState || {
              ENDED: 0,
              PLAYING: 1,
              PAUSED: 2,
              BUFFERING: 3,
              CUED: 5,
            };
            const state = e.data;
            setReady(true);

            if (state === YTState.PLAYING) {
              userPausedRef.current = false;
              playingRef.current = true;
              setPlaying(true);
              setBuffering(false);
              const d = Number(e.target.getDuration?.() || 0);
              if (d > 0) setDuration(d);
              cancelAutoAdvance();
            } else if (state === YTState.BUFFERING) {
              setBuffering(true);
              cancelAutoAdvance();
            } else if (state === YTState.PAUSED) {
              setBuffering(false);
              const msSinceSeek = Date.now() - lastSeekAtRef.current;
              if (
                !userPausedRef.current &&
                (isScrubbingRef.current || msSinceSeek < 1200) &&
                document.visibilityState !== "hidden"
              ) {
                try {
                  e.target.playVideo?.();
                } catch {}
                return;
              }
              playingRef.current = false;
              setPlaying(false);
            } else if (state === YTState.CUED) {
              setBuffering(false);
              if (!userPausedRef.current) {
                try {
                  e.target.playVideo?.();
                } catch {}
              }
            } else if (state === YTState.ENDED) {
              setBuffering(false);
              try {
                localStorage.removeItem(`video_pos_${videoId}`);
              } catch {}
              if (loopRef.current) {
                userPausedRef.current = false;
                lastSeekAtRef.current = Date.now();
                e.target.seekTo(0, true);
                e.target.playVideo();
              } else {
                playingRef.current = false;
                setPlaying(false);
                if (nextItemRef.current) {
                  setAutoAdvanceSeconds(5);
                  setAutoAdvanceTimer(true);
                }
              }
            }
          },
          onError: () => {
            if (cancelled) return;
            clearTimeout(fallbackReadyTimer);
            setReady(true);
            setBuffering(false);
          },
        },
      });
      playerInstanceRef.current = inst;

      // Safety fallback: never keep the loading spinner stuck forever if postMessage is delayed
      fallbackReadyTimer = setTimeout(() => {
        if (!cancelled) {
          setPlayer((prev) => prev || inst);
          setReady(true);
          setBuffering(false);
        }
      }, 1500);
    };

    let pollInterval = null;
    if (/** @type {any} */ (window).YT?.Player) {
      initPlayer();
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
      pollInterval = setInterval(() => {
        if (/** @type {any} */ (window).YT?.Player) {
          clearInterval(pollInterval);
          pollInterval = null;
          initPlayer();
        }
      }, 80);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      clearTimeout(fallbackReadyTimer);
      clearTimeout(resumeGuardTimerRef.current);
      if (playerInstanceRef.current) {
        try {
          playerInstanceRef.current.destroy();
        } catch {}
        playerInstanceRef.current = null;
      }
    };
  }, [videoId, isOnline, usingNativeVideo, checkingOffline, cancelAutoAdvance]);

  // Time update polling + save position (skips updating currentTime while user is scrubbing)
  useEffect(() => {
    if (!player || !ready) return;
    const interval = setInterval(() => {
      try {
        const d = Number(player.getDuration?.() || 0);
        if (d > 0) setDuration(d);

        const loaded = player.getVideoLoadedFraction?.();
        if (typeof loaded === "number" && d > 0) {
          setBufferedPct(Math.min(100, Math.max(0, loaded * 100)));
        }

        if (!isScrubbingRef.current) {
          const cur = Number(player.getCurrentTime?.() || 0);
          setCurrentTime(cur);
          if (posKey && cur > 2) {
            if (d > 0 && cur >= d - 4) {
              localStorage.removeItem(`video_pos_${posKey}`);
            } else {
              localStorage.setItem(`video_pos_${posKey}`, String(Math.floor(cur)));
            }
          }
        }
      } catch {}
    }, 250);
    return () => clearInterval(interval);
  }, [player, ready, posKey]);

  // Fullscreen handling
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const showControlsTemp = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (
        playingRef.current &&
        !isScrubbingRef.current &&
        !showPlaylistRef.current &&
        !showSpeedMenuRef.current &&
        !showShortcutsModalRef.current
      ) {
        setShowControls(false);
        setShowVolumeSlider(false);
      }
    }, 3500);
  }, []);

  const togglePlay = useCallback(() => {
    if (!player) return;
    let isCurrentlyPlaying = playingRef.current;
    try {
      const st = player.getPlayerState?.();
      if (st === 1 || st === 3) isCurrentlyPlaying = true;
      else if (st === 2 || st === 0 || st === 5) isCurrentlyPlaying = false;
    } catch {}

    if (isCurrentlyPlaying) {
      userPausedRef.current = true;
      playingRef.current = false;
      setPlaying(false);
      setBuffering(false);
      try {
        player.pauseVideo();
      } catch {}
    } else {
      userPausedRef.current = false;
      playingRef.current = true;
      setPlaying(true);
      try {
        player.playVideo();
      } catch {}
    }
    showControlsTemp();
  }, [player, showControlsTemp]);

  const handleRestart = useCallback(() => {
    if (!player) return;
    userPausedRef.current = false;
    lastSeekAtRef.current = Date.now();
    setCurrentTime(0);
    try {
      player.seekTo(0, true);
      player.playVideo();
    } catch {}
  }, [player]);

  const skip = useCallback(
    (sec) => {
      if (!player) return;
      try {
        const cur = Number(player.getCurrentTime?.() || currentTime || 0);
        const maxDur = duration > 0 ? duration : cur + Math.abs(sec);
        const target = Math.min(maxDur, Math.max(0, cur + sec));
        lastSeekAtRef.current = Date.now();
        setCurrentTime(target);
        player.seekTo(target, true);
        if (!userPausedRef.current) {
          player.playVideo?.();
        }
      } catch {}
    },
    [player, currentTime, duration]
  );

  const selectSpeed = useCallback(
    (s) => {
      if (!player?.setPlaybackRate) return;
      setRate(s);
      lastSeekAtRef.current = Date.now();
      try {
        player.setPlaybackRate(s);
      } catch {}
      setShowSpeedMenu(false);
    },
    [player]
  );

  const toggleLoop = useCallback(() => {
    setLoop((prev) => {
      const next = !prev;
      loopRef.current = next;
      return next;
    });
  }, []);

  const toggleMute = useCallback(() => {
    if (!player) return;
    try {
      if (mutedRef.current) {
        player.unMute();
        mutedRef.current = false;
        setMuted(false);
        const v = Number(player.getVolume?.() || volumeRef.current || 100);
        const nextVol = v === 0 ? 50 : v;
        if (v === 0) player.setVolume?.(nextVol);
        volumeRef.current = nextVol;
        setVolume(nextVol);
      } else {
        player.mute();
        mutedRef.current = true;
        setMuted(true);
      }
    } catch {}
  }, [player]);

  const handleVolumeChange = useCallback(
    (newVal) => {
      if (!player) return;
      const clamped = Math.max(0, Math.min(100, Number(newVal) || 0));
      volumeRef.current = clamped;
      setVolume(clamped);
      try {
        player.setVolume(clamped);
        if (clamped === 0) {
          player.mute();
          mutedRef.current = true;
          setMuted(true);
        } else if (mutedRef.current) {
          player.unMute();
          mutedRef.current = false;
          setMuted(false);
        }
      } catch {}
    },
    [player]
  );

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (showShortcutsModalRef.current) setShowShortcutsModal(false);
        else if (showSpeedMenuRef.current) setShowSpeedMenu(false);
        else if (showPlaylistRef.current) setShowPlaylist(false);
        else if (document.fullscreenElement) document.exitFullscreen();
        else onClose?.();
      } else if (e.key === " " && player) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" && player) {
        e.preventDefault();
        skip(-5);
      } else if (e.key === "ArrowRight" && player) {
        e.preventDefault();
        skip(5);
      } else if (e.key === "ArrowUp" && player) {
        e.preventDefault();
        handleVolumeChange(Math.min(100, (mutedRef.current ? 0 : volumeRef.current) + 10));
      } else if (e.key === "ArrowDown" && player) {
        e.preventDefault();
        handleVolumeChange(Math.max(0, (mutedRef.current ? 0 : volumeRef.current) - 10));
      } else if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "l" || e.key === "L") {
        toggleLoop();
      } else if (e.key === "?") {
        setShowShortcutsModal((s) => !s);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    player,
    onClose,
    togglePlay,
    skip,
    handleVolumeChange,
    toggleMute,
    toggleFullscreen,
    toggleLoop,
  ]);

  // Touch gestures
  const getCurrentTime = useCallback(() => {
    try {
      return player?.getCurrentTime?.() || currentTime || 0;
    } catch {
      return currentTime || 0;
    }
  }, [player, currentTime]);

  const handleGestureVolumeSync = useCallback((vol, isNowMuted) => {
    volumeRef.current = vol;
    mutedRef.current = isNowMuted;
    setVolume(vol);
    setMuted(isNowMuted);
  }, []);

  const handleGestureSeekCommit = useCallback(
    (targetTime) => {
      lastSeekAtRef.current = Date.now();
      setCurrentTime(targetTime);
      if (!userPausedRef.current) {
        try {
          player?.playVideo?.();
        } catch {}
      }
    },
    [player]
  );

  const { onTouchStart, onTouchMove, onTouchEnd, seekPreview, adjust, ripple, brightness } =
    usePlayerGestures({
      player,
      duration,
      getCurrentTime,
      onVolumeSync: handleGestureVolumeSync,
      onSeekCommit: handleGestureSeekCommit,
    });

  // Draggable progress bar — uses allowSeekAhead=false while dragging and allowSeekAhead=true on release
  const computeTimeFromClientX = (clientX) => {
    if (!duration || !barRef.current) return null;
    const rect = barRef.current.getBoundingClientRect();
    if (!rect.width) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const handleBarPointerDown = (e) => {
    if (!player || !duration) return;
    isScrubbingRef.current = true;
    lastSeekAtRef.current = Date.now();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const time = computeTimeFromClientX(e.clientX);
    if (time !== null) {
      setCurrentTime(time);
      try {
        player.seekTo(time, false);
      } catch {}
    }
  };

  const handleBarPointerMove = (e) => {
    if (!isScrubbingRef.current || !player || !duration) return;
    const time = computeTimeFromClientX(e.clientX);
    if (time !== null) {
      setCurrentTime(time);
      const now = Date.now();
      if (now - lastPreviewSeekCallRef.current > 120) {
        lastPreviewSeekCallRef.current = now;
        lastSeekAtRef.current = now;
        try {
          player.seekTo(time, false);
        } catch {}
      }
    }
  };

  const handleBarPointerUp = (e) => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    lastSeekAtRef.current = Date.now();
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}
    if (!player || !duration) return;
    const time = computeTimeFromClientX(e.clientX) ?? currentTime;
    setCurrentTime(time);
    try {
      player.seekTo(time, true);
      if (!userPausedRef.current) {
        player.playVideo?.();
      }
    } catch {}
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: video.title, url: video.youtube_url });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(video.youtube_url);
        toast.success(t.linkCopied);
      } catch {}
    }
  };

  // Hide bottom nav while video player is open; restore on close
  useEffect(() => {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
      clearTimeout(hideTimerRef.current);
      clearTimeout(resumeGuardTimerRef.current);
      clearTimeout(tapToggleTimerRef.current);
    };
  }, []);

  if (!isOnline && !usingNativeVideo && !checkingOffline) {
    return <OfflineVideoNotice video={video} onClose={onClose} />;
  }

  if (!videoId && !usingNativeVideo && !checkingOffline) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" dir="rtl">
        <div className="text-center text-white p-8">
          <p className="text-lg font-bold mb-2">{t.invalidVideoUrl}</p>
          <button onClick={onClose} className="text-primary hover:underline">
            {t.close}
          </button>
        </div>
      </div>
    );
  }

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black flex flex-col select-none overflow-hidden"
      dir="rtl"
      onMouseMove={showControlsTemp}
    >
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Ambient Cinema Backdrop Glow */}
        {video?.thumbnail && (
          <div
            className="absolute inset-0 opacity-25 filter blur-3xl scale-125 pointer-events-none transition-opacity duration-700"
            style={{
              backgroundImage: `url(${video.thumbnail})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}

        {/* Native HTML5 Video (for offline downloaded videos & direct MP4 files) OR YouTube iframe host */}
        {usingNativeVideo ? (
          <video
            ref={nativeVideoRef}
            src={directVideoSrc}
            poster={video?.thumbnail || ""}
            playsInline
            autoPlay
            muted={muted}
            preload="auto"
            className="w-full h-full object-contain relative z-[2] pointer-events-none select-none transition-filter duration-200"
            style={{ filter: `brightness(${brightness})` }}
          />
        ) : (
          <div
            ref={playerHostRef}
            className="w-full h-full relative z-[2] transition-filter duration-200"
            style={{ filter: `brightness(${brightness})` }}
          />
        )}

        {(!ready || buffering || checkingOffline) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 pointer-events-none">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Gesture capture layer */}
        <div
          className="absolute inset-0 z-[5] cursor-pointer"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={(e) => {
            e.stopPropagation();
            clearTimeout(tapToggleTimerRef.current);
            tapToggleTimerRef.current = setTimeout(() => {
              setShowControls((prev) => {
                const next = !prev;
                if (next) {
                  showControlsTemp();
                } else {
                  clearTimeout(hideTimerRef.current);
                  setShowVolumeSlider(false);
                  setShowSpeedMenu(false);
                }
                return next;
              });
            }, 220);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            clearTimeout(tapToggleTimerRef.current);
            toggleFullscreen();
          }}
        />

        {/* Double-tap ripple feedback */}
        <AnimatePresence>
          {ripple && (
            <motion.div
              key={ripple.key}
              initial={{ opacity: 0.4, scale: 0.5 }}
              animate={{ opacity: 0, scale: 1.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className={`absolute top-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-white/20 pointer-events-none z-[15] flex items-center justify-center text-white font-bold text-lg ${
                ripple.side === "left" ? "start-[10%]" : "end-[10%]"
              }`}
            >
              {ripple.side === "left" ? "-10s" : "+10s"}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Seek / volume / brightness indicator overlay */}
        {(seekPreview || adjust) && (
          <div
            dir="ltr"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[15] px-5 py-2.5 rounded-2xl bg-black/85 backdrop-blur-md text-white text-sm font-bold flex items-center gap-2 pointer-events-none shadow-2xl ring-1 ring-white/10"
          >
            {seekPreview && (
              <>
                {seekPreview.delta < 0 ? (
                  <Rewind className="w-4 h-4" />
                ) : (
                  <FastForward className="w-4 h-4" />
                )}
                {formatTime(seekPreview.time)}
                <span className="text-white/60 text-xs">
                  ({seekPreview.delta >= 0 ? "+" : ""}
                  {Math.round(seekPreview.delta)}s)
                </span>
              </>
            )}
            {adjust?.type === "volume" && (
              <>
                <Volume2 className="w-4 h-4" />
                {adjust.value}%
              </>
            )}
            {adjust?.type === "brightness" && (
              <>
                <Sun className="w-4 h-4" />
                {adjust.value}%
              </>
            )}
          </div>
        )}

        {/* Playlist panel */}
        <PlaylistPanel
          show={showPlaylist}
          videos={playlist}
          currentIndex={plIdx}
          onSelect={(v) => {
            setShowPlaylist(false);
            onSelectVideo?.(v);
          }}
          onClose={() => setShowPlaylist(false)}
        />

        {/* Keyboard Shortcuts Modal */}
        <AnimatePresence>
          {showShortcutsModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
              onClick={() => setShowShortcutsModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-stone-900 border border-white/15 rounded-3xl p-5 max-w-sm w-full text-white shadow-2xl space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-primary" />
                    <span>{t.shortcutsTitle}</span>
                  </h3>
                  <button
                    onClick={() => setShowShortcutsModal(false)}
                    className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2 text-xs text-stone-300">
                  <div className="flex justify-between p-2 rounded-lg bg-white/5">
                    <span>{t.shortcutPlayPause}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5">
                    <span>{t.shortcutSeek}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5">
                    <span>{t.shortcutVolume}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5">
                    <span>{t.shortcutFullscreen}</span>
                  </div>
                  <div className="flex justify-between p-2 rounded-lg bg-white/5">
                    <span>{t.shortcutMute}</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto-Advance Countdown Banner */}
        <AnimatePresence>
          {autoAdvanceTimer && nextItem && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="absolute bottom-28 inset-x-4 max-w-md mx-auto z-30 p-4 rounded-2xl bg-black/90 backdrop-blur-xl border border-white/15 shadow-2xl flex items-center justify-between gap-3 text-white"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 font-bold text-primary">
                  {autoAdvanceSeconds}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-white/70">{t.autoPlayingNext}</p>
                  <p className="text-xs font-bold truncate text-white">{nextItem.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={playNextNow}
                  className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-1"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{t.playNow}</span>
                </button>
                <button
                  onClick={cancelAutoAdvance}
                  className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 text-xs active:scale-95 transition-all"
                >
                  {t.cancel}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Header Controls */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent px-4 pt-4 pb-12 flex items-start justify-between gap-4 pointer-events-none z-20"
            >
              <div className="flex-1 min-w-0 text-white pointer-events-auto">
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-bold truncate drop-shadow-sm leading-tight">
                    {video.title}
                  </h2>
                  {usingNativeVideo && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold flex items-center gap-1 shrink-0">
                      <WifiOff className="w-2.5 h-2.5" />
                      {t.availableOfflineBadge || "بلا نت ✓"}
                    </span>
                  )}
                </div>
                {video.channel_name && (
                  <p className="text-[12px] text-white/70 mt-0.5 truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <span>{video.channel_name}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 pointer-events-auto shrink-0">
                {/* Offline Download Button inside VideoPlayer */}
                <button
                  onClick={handleToggleOfflineDownload}
                  disabled={downloadingOffline}
                  title={
                    isOfflineSaved
                      ? t.savedForOfflineTip || "محفوظ للمشاهدة بلا نت (اضغط للإزالة)"
                      : t.downloadForOfflineTip || "تحميل الفيديو للمشاهدة بلا نت"
                  }
                  className={`h-10 px-3 rounded-full backdrop-blur-md ring-1 flex items-center justify-center gap-1.5 text-xs font-bold transition-all active:scale-95 ${
                    isOfflineSaved
                      ? "bg-emerald-600/90 ring-emerald-400 text-white"
                      : downloadingOffline
                      ? "bg-primary/90 ring-primary text-white"
                      : "bg-white/10 ring-white/15 hover:bg-white/20 text-white"
                  }`}
                >
                  {downloadingOffline ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="font-mono text-[11px]">{downloadPct}%</span>
                    </>
                  ) : isOfflineSaved ? (
                    <>
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span className="hidden sm:inline">{t.offlineSavedShort || "بلا نت"}</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">{t.downloadOfflineBtn || "تحميل"}</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleToggleFav}
                  title={isFav ? t.removeFav : t.addFav}
                  className={`w-10 h-10 rounded-full backdrop-blur-md ring-1 flex items-center justify-center transition-all active:scale-95 ${
                    isFav
                      ? "bg-rose-500/90 ring-rose-400 text-white"
                      : "bg-white/10 ring-white/15 hover:bg-white/20 text-white"
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isFav ? "fill-current" : ""}`} />
                </button>
                <button
                  onClick={() => setShowShortcutsModal(true)}
                  title={t.shortcutsTitle}
                  className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={handleShare}
                  title={t.share}
                  className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  title={t.close}
                  className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center play button when paused (never shown while buffering) */}
        <AnimatePresence>
          {ready && !playing && !buffering && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="absolute inset-0 flex items-center justify-center z-15"
            >
              <div className="w-20 h-20 rounded-full bg-primary/90 backdrop-blur-md ring-4 ring-white/20 flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-transform">
                <Play className="w-9 h-9 text-white fill-white mr-1" />
              </div>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Bottom player controls */}
        <AnimatePresence>
          {showControls && ready && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pt-16 pb-4 pointer-events-none z-20"
            >
              {/* Progress bar */}
              <div
                className="flex items-center gap-3 mb-2.5 pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[11px] text-white font-mono w-12 text-center shrink-0 select-none">
                  {formatTime(currentTime)}
                </span>
                <div
                  ref={barRef}
                  dir="ltr"
                  className="relative flex-1 h-7 flex items-center cursor-pointer touch-none group"
                  onPointerDown={handleBarPointerDown}
                  onPointerMove={handleBarPointerMove}
                  onPointerUp={handleBarPointerUp}
                  onPointerCancel={handleBarPointerUp}
                >
                  <div className="relative w-full h-1.5 rounded-full bg-white/20 transition-all group-hover:h-2.5">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                      style={{ width: `${bufferedPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent"
                      style={{ width: `${progressPct}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.6)] transition-transform group-hover:scale-125"
                      style={{ left: `${progressPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-white/80 font-mono w-12 text-center shrink-0 select-none">
                  {formatTime(duration)}
                </span>
              </div>

              {/* Primary control buttons row */}
              <div
                className="flex items-center justify-center gap-3.5 pointer-events-auto mb-2"
                onClick={(e) => e.stopPropagation()}
              >
                <PlayerButton
                  onClick={() => prevItem && onSelectVideo?.(prevItem)}
                  disabled={!prevItem}
                  title={t.prevVideo}
                >
                  <SkipBack className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton onClick={() => skip(-10)} title="-10s">
                  <Rewind className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton onClick={togglePlay} primary size="lg" title={t.play}>
                  {playing ? (
                    <Pause className="w-7 h-7" />
                  ) : (
                    <Play className="w-7 h-7 fill-white ml-0.5" />
                  )}
                </PlayerButton>
                <PlayerButton onClick={() => skip(10)} title="+10s">
                  <FastForward className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton
                  onClick={() => nextItem && onSelectVideo?.(nextItem)}
                  disabled={!nextItem}
                  title={t.nextVideo}
                >
                  <SkipForward className="w-5 h-5" />
                </PlayerButton>
              </div>

              {/* Secondary Controls Bar */}
              <div
                className="flex items-center justify-center gap-1.5 pointer-events-auto relative"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.08] backdrop-blur-xl ring-1 ring-white/15 shadow-xl">
                  {/* Restart */}
                  <PlayerButton onClick={handleRestart} size="sm" title={t.restartPlayback}>
                    <RotateCcw className="w-4 h-4" />
                  </PlayerButton>

                  {/* Speed Popover Toggle */}
                  <div className="relative">
                    <button
                      onClick={() => setShowSpeedMenu((s) => !s)}
                      title={t.speedLabel}
                      className={`h-9 px-3 rounded-full flex items-center gap-1 text-xs font-bold transition-all shrink-0 ${
                        rate !== 1
                          ? "bg-primary text-primary-foreground shadow"
                          : "bg-white/10 hover:bg-white/20 text-white"
                      }`}
                    >
                      <Gauge className="w-3.5 h-3.5" />
                      <span>{rate}x</span>
                    </button>

                    {/* Speed options popover */}
                    {showSpeedMenu && (
                      <div className="absolute bottom-11 start-1/2 -translate-x-1/2 bg-stone-900/95 backdrop-blur-xl border border-white/15 rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 min-w-[70px] z-30">
                        {SPEED_OPTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => selectSpeed(s)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-mono tabular-nums transition-colors text-center ${
                              rate === s
                                ? "bg-primary text-white font-bold"
                                : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Loop toggle */}
                  <PlayerButton onClick={toggleLoop} size="sm" active={loop} title={t.loopBtn}>
                    <Repeat className="w-4 h-4" />
                  </PlayerButton>

                  {/* Playlist drawer toggle */}
                  {playlist.length > 0 && (
                    <PlayerButton
                      onClick={() => setShowPlaylist((s) => !s)}
                      size="sm"
                      active={showPlaylist}
                      title={t.playlist}
                    >
                      <ListVideo className="w-4 h-4" />
                    </PlayerButton>
                  )}

                  {/* Volume with hover/tap slider */}
                  <div
                    className="relative flex items-center"
                    onMouseEnter={() => setShowVolumeSlider(true)}
                    onMouseLeave={() => setShowVolumeSlider(false)}
                  >
                    <PlayerButton onClick={toggleMute} size="sm" title={t.shortcutMute}>
                      {muted || volume === 0 ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </PlayerButton>

                    {showVolumeSlider && (
                      <div
                        dir="ltr"
                        className="hidden sm:flex items-center px-2 py-1 bg-stone-900/90 backdrop-blur rounded-full ring-1 ring-white/15 w-24 ms-1 transition-all"
                      >
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={muted ? 0 : volume}
                          onChange={(e) => handleVolumeChange(Number(e.target.value))}
                          className="w-full accent-primary h-1 cursor-pointer"
                        />
                      </div>
                    )}
                  </div>

                  {/* Fullscreen */}
                  <PlayerButton onClick={toggleFullscreen} size="sm" title={t.tbFullscreen}>
                    {fullscreen ? (
                      <Minimize className="w-4 h-4" />
                    ) : (
                      <Maximize className="w-4 h-4" />
                    )}
                  </PlayerButton>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}