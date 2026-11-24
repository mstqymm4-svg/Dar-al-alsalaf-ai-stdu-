/**
 * DAR AL TAWHID — Smart Word & Sentence Highlight Overlay Layer (القسم 10)
 *
 * Overlays synchronized per-line sentence and word highlights directly over the PDF page
 * without altering the original PDF canvas layout.
 * Allows the user to hover and tap/click any individual word or sentence region
 * anywhere on the page to start reading accurately from that exact word.
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
      className="absolute inset-0 overflow-hidden select-none"
      style={{
        pointerEvents: isAnnotationActive ? "none" : "auto",
        zIndex: 12,
      }}
    >
      {pageData.sentences.map((sent, sIdx) => {
        const isCurrentSentence = isPlayingOrPaused && sIdx === activeSentenceIndex;
        const hasLineBoxes = Array.isArray(sent.lineBoxes) && sent.lineBoxes.length > 0;
        const fallbackBox = Array.isArray(sent.box2d) && sent.box2d.length >= 4 ? sent.box2d : null;

        const lineRects = hasLineBoxes
          ? sent.lineBoxes
          : fallbackBox
          ? [
              {
                topPct: Math.max(0, Math.min(98, fallbackBox[0] / 10)),
                leftPct: Math.max(0, Math.min(98, fallbackBox[1] / 10)),
                widthPct: Math.max(2, Math.min(98, (fallbackBox[3] - fallbackBox[1]) / 10)),
                heightPct: Math.max(1.8, Math.min(45, (fallbackBox[2] - fallbackBox[0]) / 10)),
              },
            ]
          : [];

        return (
          <React.Fragment key={`sent-box-${sIdx}`}>
            {/* Per-Line Sentence Highlight Boxes */}
            {lineRects.map((rect, lIdx) => (
              <div
                key={`sent-line-${sIdx}-${lIdx}`}
                onClick={(e) => {
                  if (isAnnotationActive) return;
                  e.stopPropagation();
                  onSelectSentenceOrWord?.(sIdx, 0, pageData.pageNumber);
                }}
                title="اضغط لبدء القراءة الصوتية من هذه الجملة"
                className="absolute transition-all duration-100 rounded-md cursor-pointer group"
                style={{
                  top: `${rect.topPct}%`,
                  left: `${rect.leftPct}%`,
                  width: `${rect.widthPct}%`,
                  height: `${rect.heightPct}%`,
                  backgroundColor:
                    isCurrentSentence && sentenceHighlightEnabled
                      ? colorCfg.sentenceBg
                      : "transparent",
                  border:
                    isCurrentSentence && sentenceHighlightEnabled
                      ? `1.5px solid ${colorCfg.wordBorder}`
                      : "1px solid transparent",
                  boxShadow:
                    isCurrentSentence && sentenceHighlightEnabled
                      ? `0 0 10px ${colorCfg.sentenceBg}`
                      : "none",
                  zIndex: 12,
                }}
              >
                {!isCurrentSentence && !isAnnotationActive && (
                  <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity rounded-md border border-dashed border-[#0891B2]/45 bg-[#A5F3FC]/10" />
                )}
              </div>
            ))}

            {/* Individual Word Boxes (Clickable on ALL sentences so user can tap any exact word with pinpoint accuracy) */}
            {Array.isArray(sent.words) &&
              sent.words.map((wObj, wIdx) => {
                if (!wObj?.rect) return null;
                const isCurrentWord =
                  isCurrentSentence && wordHighlightEnabled && wIdx === activeWordIndex;

                return (
                  <div
                    key={`word-box-${sIdx}-${wIdx}`}
                    onClick={(e) => {
                      if (isAnnotationActive) return;
                      e.stopPropagation();
                      onSelectSentenceOrWord?.(sIdx, wIdx, pageData.pageNumber);
                    }}
                    title={wObj.word ? `اقرأ من: ${wObj.word}` : "اضغط للقراءة من هذه الكلمة"}
                    className={`absolute transition-all duration-75 rounded-[4px] cursor-pointer ${
                      !isCurrentWord && !isAnnotationActive
                        ? "hover:bg-[#0891B2]/25 hover:ring-1 hover:ring-[#0891B2] hover:border-b-2 hover:border-[#0891B2]"
                        : ""
                    }`}
                    style={{
                      top: `${wObj.rect.topPct}%`,
                      left: `${wObj.rect.leftPct}%`,
                      width: `${wObj.rect.widthPct}%`,
                      height: `${wObj.rect.heightPct}%`,
                      backgroundColor: isCurrentWord ? colorCfg.wordBg : undefined,
                      borderBottom: isCurrentWord
                        ? `3px solid ${colorCfg.wordBorder}`
                        : undefined,
                      boxShadow: isCurrentWord
                        ? `0 2px 8px ${colorCfg.wordBg}`
                        : undefined,
                      transform: isCurrentWord ? "scale(1.06)" : "none",
                      zIndex: isCurrentWord ? 18 : 15,
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
