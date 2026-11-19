import React, { useRef, useEffect, useState, useCallback } from "react";
import { X, Check, GripHorizontal } from "lucide-react";
import { useT } from "@/lib/i18n";

const ANNOT_PREFIX = "dau_annot_";
// In-memory redo stack keyed by `${bookId}_p${pageNumber}`
const redoStacks = new Map();

function getStorageKey(bookId, pageNumber) {
  return `${ANNOT_PREFIX}${bookId || "default"}_p${pageNumber}`;
}

export function loadPageAnnotations(bookId, pageNumber) {
  try {
    const raw = localStorage.getItem(getStorageKey(bookId, pageNumber));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePageAnnotations(bookId, pageNumber, items) {
  try {
    const key = getStorageKey(bookId, pageNumber);
    if (!items || items.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(items));
    }
  } catch {}
}

export function getPageAnnotationCount(bookId, pageNumber) {
  return loadPageAnnotations(bookId, pageNumber).length;
}

export function canRedoPageAnnotation(bookId, pageNumber) {
  const stack = redoStacks.get(getStorageKey(bookId, pageNumber));
  return Boolean(stack && stack.length > 0);
}

export function undoPageAnnotation(bookId, pageNumber) {
  const key = getStorageKey(bookId, pageNumber);
  const items = loadPageAnnotations(bookId, pageNumber);
  if (items.length === 0) return false;
  const popped = items[items.length - 1];
  const next = items.slice(0, -1);
  const stack = redoStacks.get(key) || [];
  stack.push(popped);
  redoStacks.set(key, stack);
  savePageAnnotations(bookId, pageNumber, next);
  return true;
}

export function redoPageAnnotation(bookId, pageNumber) {
  const key = getStorageKey(bookId, pageNumber);
  const stack = redoStacks.get(key);
  if (!stack || stack.length === 0) return false;
  const restored = stack.pop();
  redoStacks.set(key, stack);
  const items = loadPageAnnotations(bookId, pageNumber);
  items.push(restored);
  savePageAnnotations(bookId, pageNumber, items);
  return true;
}

export function clearPageAnnotations(bookId, pageNumber) {
  const key = getStorageKey(bookId, pageNumber);
  const items = loadPageAnnotations(bookId, pageNumber);
  if (items.length > 0) {
    redoStacks.set(key, [...items]);
  }
  savePageAnnotations(bookId, pageNumber, []);
  return true;
}

// Resolve ink color so dark ink automatically becomes visible white/light ink in Night Mode
function resolveStrokeColor(rawColor, isDarkTheme) {
  const c = (rawColor || "#EF4444").toUpperCase();
  if (isDarkTheme && (c === "#111827" || c === "#000000" || c === "#1F2937")) {
    return "#F9FAFB";
  }
  return rawColor || "#EF4444";
}

function drawItemOnContext(ctx, item, width, height, isDarkTheme) {
  if (!item) return;
  const isHighlighter = item.tool === "highlighter";
  const resolvedColor = resolveStrokeColor(item.color, isDarkTheme);

  ctx.save();
  ctx.strokeStyle = resolvedColor;
  ctx.fillStyle = resolvedColor;

  const scaleFactor = Math.max(0.5, width / 600);
  const baseWidth = Number(item.size) || (isHighlighter ? 18 : 3.5);
  const pxWidth = baseWidth * scaleFactor;
  ctx.lineWidth = pxWidth;
  ctx.lineCap = isHighlighter ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = isHighlighter ? 0.32 : 0.96;

  // Shape tools: line, rect, circle
  if (item.tool === "line" && Array.isArray(item.points) && item.points.length >= 2) {
    const start = item.points[0];
    const end = item.points[item.points.length - 1];
    ctx.beginPath();
    ctx.moveTo(start[0] * width, start[1] * height);
    ctx.lineTo(end[0] * width, end[1] * height);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (item.tool === "rect" && Array.isArray(item.points) && item.points.length >= 2) {
    const start = item.points[0];
    const end = item.points[item.points.length - 1];
    const rx = Math.min(start[0], end[0]) * width;
    const ry = Math.min(start[1], end[1]) * height;
    const rw = Math.abs(end[0] - start[0]) * width;
    const rh = Math.abs(end[1] - start[1]) * height;
    ctx.beginPath();
    ctx.strokeRect(rx, ry, Math.max(2, rw), Math.max(2, rh));
    ctx.restore();
    return;
  }

  if (item.tool === "circle" && Array.isArray(item.points) && item.points.length >= 2) {
    const start = item.points[0];
    const end = item.points[item.points.length - 1];
    const cx = ((start[0] + end[0]) / 2) * width;
    const cy = ((start[1] + end[1]) / 2) * height;
    const rx = Math.max(2, (Math.abs(end[0] - start[0]) / 2) * width);
    const ry = Math.max(2, (Math.abs(end[1] - start[1]) / 2) * height);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Freehand Pen or Highlighter stroke
  if (!Array.isArray(item.points) || item.points.length === 0) {
    ctx.restore();
    return;
  }

  const pts = item.points;
  if (pts.length === 1) {
    const x = pts[0][0] * width;
    const y = pts[0][1] * height;
    ctx.beginPath();
    ctx.arc(x, y, pxWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0] * width, pts[0][1] * height);

  if (pts.length === 2) {
    ctx.lineTo(pts[1][0] * width, pts[1][1] * height);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const x1 = pts[i][0] * width;
      const y1 = pts[i][1] * height;
      const x2 = pts[i + 1][0] * width;
      const y2 = pts[i + 1][1] * height;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      ctx.quadraticCurveTo(x1, y1, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * width, last[1] * height);
  }

  ctx.stroke();
  ctx.restore();
}

// Distance from point (px, py) to segment (x1, y1)-(x2, y2)
function distToSegmentSquared(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return (px - projX) * (px - projX) + (py - projY) * (py - projY);
}

function hitTestItem(item, normX, normY, radiusNorm = 0.035) {
  if (!item || !Array.isArray(item.points) || item.points.length === 0) return false;
  const r2 = radiusNorm * radiusNorm;
  const pts = item.points;

  if (item.tool === "line" && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    return distToSegmentSquared(normX, normY, start[0], start[1], end[0], end[1]) <= r2;
  }

  if ((item.tool === "rect" || item.tool === "circle") && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const minX = Math.min(start[0], end[0]) - radiusNorm;
    const maxX = Math.max(start[0], end[0]) + radiusNorm;
    const minY = Math.min(start[1], end[1]) - radiusNorm;
    const maxY = Math.max(start[1], end[1]) + radiusNorm;
    return normX >= minX && normX <= maxX && normY >= minY && normY <= maxY;
  }

  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i][0] - normX;
    const dy = pts[i][1] - normY;
    if (dx * dx + dy * dy <= r2) return true;
    if (i > 0) {
      if (
        distToSegmentSquared(
          normX,
          normY,
          pts[i - 1][0],
          pts[i - 1][1],
          pts[i][0],
          pts[i][1]
        ) <= r2
      ) {
        return true;
      }
    }
  }
  return false;
}

export default function PageAnnotationLayer({
  bookId,
  pageNumber,
  width,
  height,
  active = false,
  tool = "pen", // "pen" | "highlighter" | "line" | "rect" | "circle" | "text" | "eraser" | "pan"
  color = "#EF4444",
  size = 3.5,
  theme = "light",
  revision = 0,
  onAnnotationChange,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const drawingRef = useRef({
    isDown: false,
    pointerId: null,
    currentStroke: null,
    draggingNoteId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
  });

  const [annotations, setAnnotations] = useState(() =>
    loadPageAnnotations(bookId, pageNumber)
  );
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const [draftNote, setDraftNote] = useState(null); // { id, x, y, text, color }
  const [eraserPos, setEraserPos] = useState(null); // { x, y } in [0..1]

  const isDark = theme === "dark" || theme === "dusk";
  const isDrawingActive = active && tool !== "pan";

  // Reload annotations when bookId, pageNumber, or external revision (Undo/Redo/Clear) changes
  useEffect(() => {
    const loaded = loadPageAnnotations(bookId, pageNumber);
    setAnnotations(loaded);
  }, [bookId, pageNumber, revision]);

  // Render all vector strokes onto the canvas
  const redrawCanvas = useCallback(
    (itemsToDraw, liveStroke = null) => {
      const canvas = canvasRef.current;
      if (!canvas || !width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const pxW = Math.max(1, Math.round(width * dpr));
      const pxH = Math.max(1, Math.round(height * dpr));

      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < itemsToDraw.length; i++) {
        const it = itemsToDraw[i];
        if (it.type !== "text") {
          drawItemOnContext(ctx, it, width, height, isDark);
        }
      }
      if (liveStroke) {
        drawItemOnContext(ctx, liveStroke, width, height, isDark);
      }
      ctx.restore();
    },
    [width, height, isDark]
  );

  useEffect(() => {
    if (!active && annotations.length === 0) return;
    redrawCanvas(annotations, drawingRef.current.currentStroke);
  }, [annotations, width, height, active, isDark, redrawCanvas]);

  const commitAnnotations = useCallback(
    (nextItems, clearRedo = true) => {
      if (clearRedo) {
        redoStacks.delete(getStorageKey(bookId, pageNumber));
      }
      setAnnotations(nextItems);
      annotationsRef.current = nextItems;
      savePageAnnotations(bookId, pageNumber, nextItems);
      onAnnotationChange?.();
    },
    [bookId, pageNumber, onAnnotationChange]
  );

  const getNormalizedCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return {
      x: +nx.toFixed(4),
      y: +ny.toFixed(4),
    };
  };

  const eraseAtPoint = (nx, ny) => {
    const cur = annotationsRef.current;
    const filtered = cur.filter((item) => {
      if (item.type === "text") {
        const dx = Math.abs((item.x || 0) - nx);
        const dy = Math.abs((item.y || 0) - ny);
        return !(dx < 0.08 && dy < 0.05);
      }
      return !hitTestItem(item, nx, ny, 0.036);
    });
    if (filtered.length !== cur.length) {
      const key = getStorageKey(bookId, pageNumber);
      redoStacks.set(key, [...cur]);
      commitAnnotations(filtered, false);
    }
  };

  const handlePointerDown = (e) => {
    if (!isDrawingActive) return;
    if (e.button !== undefined && e.button !== 0) return;

    // Allow secondary touch pointer for two-finger pinch zoom
    if (e.pointerType === "touch" && !e.isPrimary) {
      drawingRef.current.isDown = false;
      drawingRef.current.currentStroke = null;
      setEraserPos(null);
      redrawCanvas(annotationsRef.current, null);
      return;
    }

    e.stopPropagation();

    const { x, y } = getNormalizedCoords(e);

    if (tool === "text") {
      e.preventDefault();
      setDraftNote({
        id: `txt_${Date.now()}`,
        x: Math.min(0.84, Math.max(0.16, x)),
        y: Math.min(0.86, Math.max(0.12, y)),
        text: "",
        color,
      });
      return;
    }

    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    if (tool === "eraser") {
      drawingRef.current.isDown = true;
      drawingRef.current.pointerId = e.pointerId;
      setEraserPos({ x, y });
      eraseAtPoint(x, y);
      return;
    }

    const effectiveSize =
      tool === "highlighter" ? Math.max(14, size * 3.8) : size;

    const newStroke = {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: "stroke",
      tool,
      color,
      size: effectiveSize,
      points: [[x, y]],
    };

    drawingRef.current.isDown = true;
    drawingRef.current.pointerId = e.pointerId;
    drawingRef.current.currentStroke = newStroke;
    redrawCanvas(annotationsRef.current, newStroke);
  };

  const handlePointerMove = (e) => {
    if (!isDrawingActive || !drawingRef.current.isDown) return;
    if (
      drawingRef.current.pointerId !== null &&
      e.pointerId !== drawingRef.current.pointerId
    ) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    const { x, y } = getNormalizedCoords(e);

    if (tool === "eraser") {
      setEraserPos({ x, y });
      eraseAtPoint(x, y);
      return;
    }

    const stroke = drawingRef.current.currentStroke;
    if (!stroke) return;

    // For geometric shape tools (line, rect, circle), only keep [startPoint, currentPoint]
    if (tool === "line" || tool === "rect" || tool === "circle") {
      stroke.points = [stroke.points[0], [x, y]];
      redrawCanvas(annotationsRef.current, stroke);
      return;
    }

    const pts = stroke.points;
    const last = pts[pts.length - 1];
    const dist = Math.hypot(x - last[0], y - last[1]);
    if (dist < 0.002) return;

    stroke.points.push([x, y]);
    redrawCanvas(annotationsRef.current, stroke);
  };

  const finishDrawing = (e) => {
    if (!drawingRef.current.isDown) return;
    e?.stopPropagation?.();
    try {
      if (drawingRef.current.pointerId !== null) {
        e?.currentTarget?.releasePointerCapture?.(drawingRef.current.pointerId);
      }
    } catch {}

    setEraserPos(null);
    const stroke = drawingRef.current.currentStroke;
    drawingRef.current.isDown = false;
    drawingRef.current.pointerId = null;
    drawingRef.current.currentStroke = null;

    if (stroke && stroke.points.length > 0) {
      // Ignore accidental zero-length shape taps
      if (
        (stroke.tool === "line" || stroke.tool === "rect" || stroke.tool === "circle") &&
        stroke.points.length < 2
      ) {
        redrawCanvas(annotationsRef.current, null);
        return;
      }
      const next = [...annotationsRef.current, stroke];
      commitAnnotations(next, true);
    }
  };

  // Dragging existing text notes on the page
  const startNoteDrag = (e, note) => {
    if (!isDrawingActive || tool === "eraser") return;
    e.stopPropagation();
    const { x, y } = getNormalizedCoords(e);
    drawingRef.current.draggingNoteId = note.id;
    drawingRef.current.dragOffsetX = (note.x || 0.5) - x;
    drawingRef.current.dragOffsetY = (note.y || 0.5) - y;
  };

  const moveNoteDrag = (e) => {
    const noteId = drawingRef.current.draggingNoteId;
    if (!noteId) return;
    e.stopPropagation();
    const { x, y } = getNormalizedCoords(e);
    const nextX = Math.max(0.08, Math.min(0.92, +(x + drawingRef.current.dragOffsetX).toFixed(4)));
    const nextY = Math.max(0.06, Math.min(0.94, +(y + drawingRef.current.dragOffsetY).toFixed(4)));
    const updated = annotationsRef.current.map((it) =>
      it.id === noteId ? { ...it, x: nextX, y: nextY } : it
    );
    setAnnotations(updated);
    annotationsRef.current = updated;
  };

  const endNoteDrag = (e) => {
    if (!drawingRef.current.draggingNoteId) return;
    e?.stopPropagation?.();
    drawingRef.current.draggingNoteId = null;
    savePageAnnotations(bookId, pageNumber, annotationsRef.current);
  };

  const saveDraftNote = () => {
    if (!draftNote) return;
    const trimmed = (draftNote.text || "").trim();
    if (trimmed) {
      const next = [
        ...annotationsRef.current.filter((it) => it.id !== draftNote.id),
        {
          id: draftNote.id,
          type: "text",
          x: draftNote.x,
          y: draftNote.y,
          text: trimmed,
          color: draftNote.color || color,
        },
      ];
      commitAnnotations(next, true);
    }
    setDraftNote(null);
  };

  const deleteTextNote = (id) => {
    const next = annotationsRef.current.filter((it) => it.id !== id);
    commitAnnotations(next, true);
  };

  // Zero-overhead fast path: if Pen mode is OFF and page has 0 annotations, do NOT mount a second canvas
  if (!active && annotations.length === 0) {
    return null;
  }

  const textNotes = annotations.filter((it) => it.type === "text");

  return (
    <div
      data-annotation-layer
      onPointerMove={moveNoteDrag}
      onPointerUp={endNoteDrag}
      className={`absolute inset-0 z-10 select-none ${
        isDrawingActive ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={{
        touchAction: isDrawingActive ? "none" : "auto",
        cursor: isDrawingActive
          ? tool === "eraser"
            ? "cell"
            : tool === "text"
            ? "text"
            : "crosshair"
          : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
        style={{
          touchAction: isDrawingActive ? "none" : "auto",
        }}
        className="w-full h-full block"
      />

      {/* Live Eraser Visual Ring */}
      {isDrawingActive && tool === "eraser" && eraserPos && (
        <div
          style={{
            left: `${eraserPos.x * 100}%`,
            top: `${eraserPos.y * 100}%`,
          }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-rose-500 bg-rose-500/20 shadow"
        />
      )}

      {/* Saved Text Notes on the Page */}
      {textNotes.map((note) => (
        <div
          key={note.id}
          onPointerDown={(e) => startNoteDrag(e, note)}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDrawingActive) return;
            if (tool === "eraser") {
              deleteTextNote(note.id);
            } else {
              setDraftNote(note);
            }
          }}
          style={{
            left: `${(note.x || 0.1) * 100}%`,
            top: `${(note.y || 0.1) * 100}%`,
            borderColor: resolveStrokeColor(note.color, isDark),
          }}
          className={`absolute -translate-x-1/2 -translate-y-1/2 max-w-[210px] px-2.5 py-1.5 rounded-xl border-2 shadow-lg text-xs font-bold leading-snug break-words transition-transform ${
            isDrawingActive
              ? "pointer-events-auto cursor-move hover:scale-105"
              : "pointer-events-none"
          } ${
            isDark
              ? "bg-neutral-900/95 text-stone-100"
              : "bg-amber-50/95 text-stone-900"
          }`}
        >
          <div className="flex items-start gap-1.5">
            {isDrawingActive && (
              <GripHorizontal className="w-3.5 h-3.5 opacity-50 shrink-0 mt-0.5" />
            )}
            <span className="flex-1">{note.text}</span>
            {isDrawingActive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTextNote(note.id);
                }}
                className="ms-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Active Text Note Editor Popover */}
      {isDrawingActive && draftNote && (
        <div
          data-viewer-ui
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            left: `${Math.min(72, Math.max(28, draftNote.x * 100))}%`,
            top: `${Math.min(78, Math.max(18, draftNote.y * 100))}%`,
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 z-30 w-60 p-3 rounded-2xl bg-neutral-900/95 text-white border border-white/20 shadow-2xl pointer-events-auto"
          dir="auto"
        >
          <textarea
            autoFocus
            rows={2}
            value={draftNote.text}
            onChange={(e) =>
              setDraftNote((d) => (d ? { ...d, text: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                saveDraftNote();
              } else if (e.key === "Escape") {
                setDraftNote(null);
              }
            }}
            placeholder={t.penNotePlaceholder || "اكتب ملاحظتك على هذه الصفحة..."}
            className="w-full bg-neutral-800 text-white text-xs rounded-xl p-2.5 border border-neutral-700 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex items-center justify-end gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => setDraftNote(null)}
              className="px-2.5 py-1 rounded-lg text-[11px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
            >
              {t.cancel || "إلغاء"}
            </button>
            <button
              type="button"
              onClick={saveDraftNote}
              className="px-3 py-1 rounded-lg text-[11px] font-bold bg-primary text-primary-foreground flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              {t.penSaveNote || t.save || "حفظ"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
