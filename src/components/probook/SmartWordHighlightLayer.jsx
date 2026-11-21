/**
 * DAR AL TAWHID — Smart Word & Sentence Highlight Overlay Layer (القسم 10)
 *
 * Overlays synchronized sentence and word highlights directly over the PDF page
 * without altering the original PDF canvas layout.
 * Also allows the user to tap any sentence/word region to start reading from there.
 */

import React from "react";
import { getHighlightColorConfig } from "@/lib/intelligentReader/readerSettings";

export default function SmartWordHighlightLayer({
  pageData,
  activeSentenceIndex = 0,
  activeWordIndex = 0,
  isPlayingOrPaused = false,
  wordHighlightEnabled = true,
  sentenceHighlightEnabled = true,
  highlightColorId = "cyan",
  isAnnotationActive = false,
  onSelectSentenceOrWord,
}) {
  if (!pageData || !Array.isArray(pageData.sentences) || pageData.sentences.length === 0) {
    return null;
  }

  const colorCfg = getHighlightColorConfig(highlightColorId);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        pointerEvents: isAnnotationActive ? "none" : "auto",
        zIndex: 12,
      }}
    >
      {pageData.sentences.map((sent, sIdx) => {
        const isCurrentSentence = isPlayingOrPaused && sIdx === activeSentenceIndex;
        const box = sent.box2d;
        if (!Array.isArray(box) || box.length < 4) return null;

        const [ymin, xmin, ymax, xmax] = box;
        const topPct = Math.max(0, Math.min(98, ymin / 10));
        const leftPct = Math.max(0, Math.min(98, xmin / 10));
        const widthPct = Math.max(4, Math.min(98, (xmax - xmin) / 10));
        const heightPct = Math.max(2, Math.min(45, (ymax - ymin) / 10));

        return (
          <React.Fragment key={`sent-box-${sIdx}`}>
            {/* Sentence Bounding Box Overlay */}
            <div
              onClick={(e) => {
                if (isAnnotationActive) return;
                e.stopPropagation();
                onSelectSentenceOrWord?.(sIdx, 0);
              }}
              title="اضغط لبدء القراءة الصوتية من هذه الجملة"
              className="absolute transition-all duration-200 rounded-lg cursor-pointer group"
              style={{
                top: `${topPct}%`,
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                backgroundColor:
                  isCurrentSentence && sentenceHighlightEnabled
                    ? colorCfg.sentenceBg
                    : "transparent",
                border:
                  isCurrentSentence && sentenceHighlightEnabled
                    ? `2px solid ${colorCfg.wordBorder}`
                    : "1px solid transparent",
                boxShadow:
                  isCurrentSentence && sentenceHighlightEnabled
                    ? `0 0 14px ${colorCfg.sentenceBg}`
                    : "none",
              }}
            >
              {/* Subtle hover hint when not actively playing this sentence */}
              {!isCurrentSentence && !isAnnotationActive && (
                <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity rounded-lg border border-dashed border-[#0891B2]/50 bg-[#A5F3FC]/10" />
              )}
            </div>

            {/* Active Word Highlight Box (when word coordinates exist and wordHighlightEnabled is true) */}
            {isCurrentSentence &&
              wordHighlightEnabled &&
              Array.isArray(sent.words) &&
              sent.words.map((wObj, wIdx) => {
                if (!wObj?.rect) return null;
                const isCurrentWord = wIdx === activeWordIndex;
                return (
                  <div
                    key={`word-box-${sIdx}-${wIdx}`}
                    onClick={(e) => {
                      if (isAnnotationActive) return;
                      e.stopPropagation();
                      onSelectSentenceOrWord?.(sIdx, wIdx);
                    }}
                    title={`بدء القراءة من كلمة: ${wObj.word}`}
                    className="absolute transition-all duration-100 rounded-md cursor-pointer"
                    style={{
                      top: `${wObj.rect.topPct}%`,
                      left: `${wObj.rect.leftPct}%`,
                      width: `${wObj.rect.widthPct}%`,
                      height: `${wObj.rect.heightPct}%`,
                      backgroundColor: isCurrentWord
                        ? colorCfg.wordBg
                        : "transparent",
                      borderBottom: isCurrentWord
                        ? `3px solid ${colorCfg.wordBorder}`
                        : "none",
                      transform: isCurrentWord ? "scale(1.04)" : "none",
                      zIndex: isCurrentWord ? 15 : 13,
                    }}
                  />
                );
              })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
