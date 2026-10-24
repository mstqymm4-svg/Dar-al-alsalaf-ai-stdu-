import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Maximize, Minimize, Play, Pause, RotateCcw, Volume2, VolumeX,
  Share2, Rewind, FastForward, Repeat, SkipBack, SkipForward,
  ListVideo, Sun,
} from "lucide-react";
import { extractYoutubeId } from "@/components/dev/DevVideos";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { usePlayerGestures } from "@/hooks/usePlayerGestures";
import PlaylistPanel from "@/components/video/PlaylistPanel";
import PlayerButton from "@/components/video/PlayerButton";
import OfflineVideoNotice from "@/components/video/OfflineVideoNotice";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({ video, onClose, playlist = [], onSelectVideo }) {
  const t = useT();
  const { isOnline } = useOnlineStatus();
  const containerRef = useRef(null);
  const playerInstanceRef = useRef(null);
  const hideTimerRef = useRef(null);
  const barRef = useRef(null);
  const [player, setPlayer] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [ready, setReady] = useState(false);
  const [restoreTime, setRestoreTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(false);

  const videoId = extractYoutubeId(video?.youtube_url);

  // ── Playlist navigation (used by buttons, auto-advance and the panel) ──
  const plIdx = playlist.findIndex((v) => v.id === video.id);
  const nextItem = plIdx >= 0 && plIdx < playlist.length - 1 ? playlist[plIdx + 1] : null;
  const prevItem = plIdx > 0 ? playlist[plIdx - 1] : null;
  const nextItemRef = useRef(null);
  const onSelectVideoRef = useRef(null);
  nextItemRef.current = nextItem;
  onSelectVideoRef.current = onSelectVideo;

  // Restore last position
  useEffect(() => {
    if (!videoId) return;
    const saved = localStorage.getItem(`video_pos_${videoId}`);
    if (saved) setRestoreTime(Number(saved));
  }, [videoId]);

  // Initialize YouTube IFrame API player
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    const initPlayer = () => {
      if (cancelled || !window.YT?.Player) return;
      playerInstanceRef.current = new window.YT.Player("yt-player-container", {
        videoId,
        playerVars: {
          autoplay: 1, controls: 0, modestbranding: 1, rel: 0,
          playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
          start: restoreTime || 0,
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            setPlayer(e.target);
            setDuration(e.target.getDuration());
            setReady(true);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (cancelled) return;
            setPlaying(e.data === window.YT.PlayerState.PLAYING);
            if (e.data === window.YT.PlayerState.PLAYING) {
              setDuration(e.target.getDuration());
            } else if (e.data === window.YT.PlayerState.ENDED) {
              if (loopRef.current) {
                e.target.seekTo(0, true);
                e.target.playVideo();
              } else if (nextItemRef.current && onSelectVideoRef.current) {
                // Auto-advance to the next video in the playlist
                onSelectVideoRef.current(nextItemRef.current);
              }
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
      const interval = setInterval(() => {
        if (window.YT?.Player) { clearInterval(interval); initPlayer(); }
      }, 100);
      return () => { cancelled = true; clearInterval(interval); };
    }

    return () => {
      cancelled = true;
      if (playerInstanceRef.current) {
        try { playerInstanceRef.current.destroy(); } catch(e) {}
      }
    };
  }, [videoId]);

  // Time update polling + save position
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      try {
        const cur = player.getCurrentTime() || 0;
        setCurrentTime(cur);
        const d = player.getDuration();
        if (d) setDuration(d);
        const loaded = player.getVideoLoadedFraction?.();
        if (typeof loaded === "number" && d) setBufferedPct(loaded * 100);
        if (videoId && cur > 0) {
          localStorage.setItem(`video_pos_${videoId}`, String(Math.floor(cur)));
        }
      } catch(e) {}
    }, 300);
    return () => clearInterval(interval);
  }, [player, videoId]);

  // Fullscreen handling
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) document.exitFullscreen();
        else onClose?.();
      } else if (e.key === " " && player) {
        e.preventDefault();
        if (playing) player.pauseVideo();
        else player.playVideo();
      } else if (e.key === "ArrowLeft" && player) {
        e.preventDefault();
        player.seekTo(Math.max(0, (player.getCurrentTime?.() || 0) - 5), true);
      } else if (e.key === "ArrowRight" && player) {
        e.preventDefault();
        player.seekTo((player.getCurrentTime?.() || 0) + 5, true);
      } else if (e.key === "ArrowUp" && player) {
        e.preventDefault();
        if (muted) { player.unMute(); setMuted(false); }
        player.setVolume?.(Math.min(100, (player.getVolume?.() || 100) + 10));
      } else if (e.key === "ArrowDown" && player) {
        e.preventDefault();
        player.setVolume?.(Math.max(0, (player.getVolume?.() || 100) - 10));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [player, playing, onClose, muted]);

  // ── Touch gestures (double-tap skip, drag seek, brightness & volume) ──
  const getCurrentTime = useCallback(() => {
    try { return player?.getCurrentTime?.() || 0; } catch { return 0; }
  }, [player]);
  const { onTouchStart, onTouchMove, onTouchEnd, seekPreview, adjust, ripple, brightness } =
    usePlayerGestures({ player, duration, getCurrentTime });

  const togglePlay = () => {
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  };

  const handleRestart = () => {
    if (!player) return;
    player.seekTo(0, true);
    player.playVideo();
  };

  const skip = (sec) => {
    if (!player) return;
    const cur = (player.getCurrentTime?.() || 0) + sec;
    player.seekTo(Math.max(0, cur), true);
  };

  const cycleSpeed = () => {
    if (!player?.setPlaybackRate) return;
    const steps = [0.75, 1, 1.25, 1.5, 2];
    const next = steps[(steps.indexOf(rate) + 1) % steps.length];
    setRate(next);
    player.setPlaybackRate(next);
  };

  const toggleLoop = () => {
    const v = !loop;
    setLoop(v);
    loopRef.current = v;
  };

  // Draggable progress bar
  const seekFromClientX = (clientX) => {
    if (!player || !duration || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const time = ratio * duration;
    player.seekTo(time, true);
    setCurrentTime(time);
  };

  const toggleMute = () => {
    if (!player) return;
    if (muted) { player.unMute(); setMuted(false); }
    else { player.mute(); setMuted(true); }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: video.title, url: video.youtube_url }); } catch(e) {}
    } else {
      try { await navigator.clipboard.writeText(video.youtube_url); toast.success(t.linkCopied); } catch(e) {}
    }
  };

  const showControlsTemp = () => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (playing) {
        setShowControls(false);
      }
    }, 3500);
  };

  // Hide bottom nav while video player is open; restore on close
  useEffect(() => {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.transform = "translateY(100%)";
    return () => {
      if (nav) nav.style.transform = "translateY(0)";
      clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!isOnline) {
    return <OfflineVideoNotice video={video} onClose={onClose} />;
  }

  if (!videoId) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95" dir="rtl">
        <div className="text-center text-white p-8">
          <p className="text-lg font-bold mb-2">{t.invalidVideoUrl}</p>
          <button onClick={onClose} className="text-primary hover:underline">{t.close}</button>
        </div>
      </div>
    );
  }

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      dir="rtl"
      onMouseMove={showControlsTemp}
      onClick={showControlsTemp}
    >
      <div className="flex-1 relative flex items-center justify-center">
        {/* YouTube iframe with gesture-controlled brightness */}
        <div className="w-full h-full" style={{ filter: `brightness(${brightness})` }}>
          <div id="yt-player-container" className="w-full h-full pointer-events-none" />
        </div>

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Gesture capture layer (under the control overlays) */}
        <div
          className="absolute inset-0 z-[5]"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        {/* Double-tap ripple feedback */}
        <AnimatePresence>
          {ripple && (
            <motion.div
              key={ripple.key}
              initial={{ opacity: 0.4, scale: 0.5 }}
              animate={{ opacity: 0, scale: 1.5 }}
              transition={{ duration: 0.5 }}
              className={`absolute top-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-white/20 pointer-events-none z-[15] flex items-center justify-center text-white font-bold text-lg ${
                ripple.side === "left" ? "start-[10%]" : "end-[10%]"
              }`}
            >
              {ripple.side === "left" ? "-10s" : "+10s"}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Seek / volume / brightness indicator */}
        {(seekPreview || adjust) && (
          <div
            dir="ltr"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[15] px-5 py-2.5 rounded-2xl bg-black/75 text-white text-sm font-bold flex items-center gap-2 pointer-events-none"
          >
            {seekPreview && (
              <>
                {seekPreview.delta < 0 ? <Rewind className="w-4 h-4" /> : <FastForward className="w-4 h-4" />}
                {formatTime(seekPreview.time)}
                <span className="text-white/60 text-xs">
                  ({seekPreview.delta >= 0 ? "+" : ""}{Math.round(seekPreview.delta)}s)
                </span>
              </>
            )}
            {adjust?.type === "volume" && (<><Volume2 className="w-4 h-4" />{adjust.value}%</>)}
            {adjust?.type === "brightness" && (<><Sun className="w-4 h-4" />{adjust.value}%</>)}
          </div>
        )}

        {/* Playlist panel */}
        <PlaylistPanel
          show={showPlaylist}
          videos={playlist}
          currentIndex={plIdx}
          onSelect={(v) => onSelectVideo?.(v)}
          onClose={() => setShowPlaylist(false)}
        />

        {/* Top bar */}
        <AnimatePresence>
          {showControls && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 pt-4 pb-10 flex items-start justify-between gap-4 pointer-events-none z-10"
            >
              <div className="flex-1 min-w-0 text-white pointer-events-auto">
                <h2 className="text-base sm:text-lg font-bold truncate drop-shadow-sm">{video.title}</h2>
                {video.channel_name && (
                  <p className="text-[11px] text-white/70 mt-0.5 truncate">{video.channel_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button onClick={handleShare} className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all">
                  <Share2 className="w-5 h-5" />
                </button>
                <button onClick={onClose} className="w-11 h-11 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center play button when paused */}
        <AnimatePresence>
          {ready && !playing && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="absolute inset-0 flex items-center justify-center z-10"
            >
              <div className="w-20 h-20 rounded-full bg-primary/90 backdrop-blur-sm ring-4 ring-white/15 flex items-center justify-center shadow-2xl">
                <Play className="w-8 h-8 text-white fill-white mr-1" />
              </div>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Bottom controls */}
        <AnimatePresence>
          {showControls && ready && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-4 pt-14 pb-3 pointer-events-none z-10"
            >
              {/* Draggable progress bar */}
              <div className="flex items-center gap-3 mb-2 pointer-events-auto">
                <span className="text-[11px] text-white font-mono w-12 text-center shrink-0">{formatTime(currentTime)}</span>
                <div
                  ref={barRef}
                  dir="ltr"
                  className="relative flex-1 h-7 flex items-center cursor-pointer touch-none group"
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromClientX(e.clientX); }}
                  onPointerMove={(e) => { if (e.buttons === 1) seekFromClientX(e.clientX); }}
                >
                  <div className="relative w-full h-1.5 rounded-full bg-white/20 transition-all group-hover:h-2.5">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferedPct}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${progressPct}%` }} />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)] transition-transform group-hover:scale-125"
                      style={{ left: `${progressPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-white/80 font-mono w-12 text-center shrink-0">{formatTime(duration)}</span>
              </div>

              {/* Primary controls — always visible, centered, large tap targets */}
              <div className="flex items-center justify-center gap-3 pointer-events-auto mb-2" onClick={(e) => e.stopPropagation()}>
                <PlayerButton onClick={() => prevItem && onSelectVideo?.(prevItem)} disabled={!prevItem} title={t.prevVideo}>
                  <SkipBack className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton onClick={() => skip(-10)} title="-10s">
                  <Rewind className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton onClick={togglePlay} primary size="lg" title={t.play}>
                  {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-white ml-0.5" />}
                </PlayerButton>
                <PlayerButton onClick={() => skip(10)} title="+10s">
                  <FastForward className="w-5 h-5" />
                </PlayerButton>
                <PlayerButton onClick={() => nextItem && onSelectVideo?.(nextItem)} disabled={!nextItem} title={t.nextVideo}>
                  <SkipForward className="w-5 h-5" />
                </PlayerButton>
              </div>

              {/* Secondary controls — compact pill row */}
              <div className="flex items-center justify-center gap-1 pointer-events-auto overflow-x-auto scrollbar-hide" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-1 px-1.5 py-1 rounded-full bg-white/[0.07] backdrop-blur-md ring-1 ring-white/10">
                  <PlayerButton onClick={handleRestart} size="sm" title={t.restartPlayback}>
                    <RotateCcw className="w-4 h-4" />
                  </PlayerButton>
                  <button
                    onClick={cycleSpeed}
                    title={t.speedLabel || "Speed"}
                    className="h-10 px-3 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center text-white text-xs font-bold transition-all shrink-0"
                  >
                    {rate}x
                  </button>
                  <PlayerButton onClick={toggleLoop} size="sm" active={loop} title={t.loopBtn}>
                    <Repeat className="w-4 h-4" />
                  </PlayerButton>
                  {playlist.length > 0 && (
                    <PlayerButton onClick={() => setShowPlaylist((s) => !s)} size="sm" active={showPlaylist} title={t.playlist}>
                      <ListVideo className="w-4 h-4" />
                    </PlayerButton>
                  )}
                  <PlayerButton onClick={toggleMute} size="sm">
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </PlayerButton>
                  <PlayerButton onClick={toggleFullscreen} size="sm" title={t.tbFullscreen || "Fullscreen"}>
                    {fullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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