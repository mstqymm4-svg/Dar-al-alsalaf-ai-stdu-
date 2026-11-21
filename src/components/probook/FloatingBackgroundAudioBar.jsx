/**
 * DAR AL TAWHID — Floating Background Audio Mini-Player (القسم 14)
 *
 * Appears automatically whenever the Intelligent Book Reader is playing or paused
 * in the background while the user is browsing other pages outside `/read/:id`.
 */

import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { intelligentAudioEngine } from "@/lib/intelligentReader/audioEngine";

export default function FloatingBackgroundAudioBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [snap, setSnap] = useState(() => intelligentAudioEngine.getSnapshot());

  useEffect(() => {
    return intelligentAudioEngine.subscribe(setSnap);
  }, []);

  const isInsideReader = location.pathname.startsWith("/read");
  const isActive =
    snap.playerState === "playing" ||
    snap.playerState === "paused" ||
    snap.playerState === "loading";

  if (isInsideReader || !isActive || !snap.bookId) {
    return null;
  }

  const isPlaying = snap.playerState === "playing";

  return (
    <div
      dir="rtl"
      className="fixed bottom-16 sm:bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 z-50 rounded-2xl bg-[#0F172A] text-white border border-[#0891B2] shadow-2xl p-3 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-3"
    >
      <div
        onClick={() => navigate(`/read?id=${encodeURIComponent(snap.bookId)}`)}
        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
        title="العودة إلى شاشة القارئ الذكي"
      >
        <div className="w-9 h-9 rounded-xl bg-[#155E75] flex items-center justify-center shrink-0 text-[#A5F3FC]">
          <Volume2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold truncate text-[#A5F3FC]">
            {snap.book?.title || "القارئ الصوتي — DAR AL TAWHID"}
          </div>
          <div className="text-[11px] text-slate-300 truncate">
            صفحة {snap.pageNumber} •{" "}
            {snap.currentWord ||
              snap.currentSentence?.originalText ||
              "قراءة في الخلفية"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => intelligentAudioEngine.prevSentence()}
          className="p-1.5 rounded-lg hover:bg-white/10"
          title="الجملة السابقة"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() =>
            isPlaying
              ? intelligentAudioEngine.pause("immediate")
              : intelligentAudioEngine.playFrom()
          }
          className="p-2 rounded-xl bg-[#155E75] hover:bg-[#0891B2] text-white"
          title={isPlaying ? "إيقاف مؤقت" : "استئناف"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={() => intelligentAudioEngine.nextSentence()}
          className="p-1.5 rounded-lg hover:bg-white/10"
          title="الجملة التالية"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => intelligentAudioEngine.stop()}
          className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20"
          title="إيقاف القراءة في الخلفية"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
      </div>
    </div>
  );
}
