import React, { useRef, useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Check, GripHorizontal, MessageSquare, Trash2 } from "lucide-react";
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
  const isLaser = item.tool === "laser";
  const resolvedColor = resolveStrokeColor(item.color, isDarkTheme);

  ctx.save();
  ctx.strokeStyle = resolvedColor;
  ctx.fillStyle = resolvedColor;

  const scaleFactor = Math.max(0.5, width / 600);
  const baseWidth = Number(item.size) || (isHighlighter ? 18 : isLaser ? 4.5 : 3.5);
  const pxWidth = baseWidth * scaleFactor;
  ctx.lineWidth = pxWidth;
  ctx.lineCap = isHighlighter ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = isHighlighter ? 0.32 : isLaser ? (item.alpha ?? 0.95) : 0.96;

  if (isLaser) {
    ctx.shadowColor = resolvedColor;
    ctx.shadowBlur = 14 * scaleFactor;
  }

  // Shape tools: line, underline, arrow, rect, circle
  if (
    (item.tool === "line" || item.tool === "underline") &&
    Array.isArray(item.points) &&
    item.points.length >= 2
  ) {
    const start = item.points[0];
    const end = item.points[item.points.length - 1];
    const yEnd = item.tool === "underline" ? start[1] : end[1];
    ctx.beginPath();
    ctx.moveTo(start[0] * width, start[1] * height);
    ctx.lineTo(end[0] * width, yEnd * height);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (item.tool === "arrow" && Array.isArray(item.points) && item.points.length >= 2) {
    const start = item.points[0];
    const end = item.points[item.points.length - 1];
    const x1 = start[0] * width;
    const y1 = start[1] * height;
    const x2 = end[0] * width;
    const y2 = end[1] * height;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, pxWidth * 3.4);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
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

  // Freehand Pen, Laser, or Highlighter stroke
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

  if ((item.tool === "line" || item.tool === "underline" || item.tool === "arrow") && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const endY = item.tool === "underline" ? start[1] : end[1];
    return distToSegmentSquared(normX, normY, start[0], start[1], end[0], endY) <= r2;
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

const NOTE_COLORS = [
  "#EF4444",
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#111827",
];

const NOTE_FONT_SIZES = [
  { id: "sm", label: "صغير", className: "text-xs" },
  { id: "md", label: "متوسط", className: "text-sm" },
  { id: "lg", label: "كبير", className: "text-base" },
];

export default function PageAnnotationLayer({
  bookId,
  pageNumber,
  width,
  height,
  active = false,
  tool = "pen", // "pen" | "laser" | "highlighter" | "underline" | "line" | "arrow" | "rect" | "circle" | "text" | "eraser" | "pan"
  color = "#EF4444",
  size = 3.5,
  theme = "light",
  revision = 0,
  onAnnotationChange,
  onTypingNoteChange,
}) {
  const t = useT();
  const canvasRef = useRef(null);
  const laserFadeTimerRef = useRef(null);
  const drawingRef = useRef({
    isDown: false,
    pointerId: null,
    currentStroke: null,
    draggingNoteId: null,
    notePointerId: null,
    noteStartX: 0,
    noteStartY: 0,
    noteMoved: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
  });

  const [annotations, setAnnotations] = useState(() =>
    loadPageAnnotations(bookId, pageNumber)
  );
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const [draftNote, setDraftNote] = useState(null); // { id, x, y, text, color, fontSize, noteStyle }
  const [viewingNote, setViewingNote] = useState(null); // Read-only popover when Pen mode is off or pan
  const [eraserPos, setEraserPos] = useState(null); // { x, y } in [0..1]

  const isDark = theme === "dark" || theme === "dusk";
  const isDrawingActive = active && tool !== "pan";

  useEffect(() => {
    onTypingNoteChange?.(Boolean(draftNote));
    return () => {
      if (draftNote) onTypingNoteChange?.(false);
    };
  }, [draftNote, onTypingNoteChange]);

  useEffect(() => {
    return () => {
      if (laserFadeTimerRef.current) clearInterval(laserFadeTimerRef.current);
    };
  }, []);

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
    const removed = [];
    const eraserRadius = size >= 6 ? 0.052 : size <= 2.5 ? 0.024 : 0.036;
    const filtered = cur.filter((item) => {
      let hit = false;
      if (item.type === "text") {
        const dx = Math.abs((item.x || 0) - nx);
        const dy = Math.abs((item.y || 0) - ny);
        hit = dx < 0.08 && dy < 0.05;
      } else {
        hit = hitTestItem(item, nx, ny, eraserRadius);
      }
      if (hit) removed.push(item);
      return !hit;
    });
    if (removed.length > 0) {
      const key = getStorageKey(bookId, pageNumber);
      const stack = redoStacks.get(key) || [];
      for (const r of removed) {
        stack.push(r);
      }
      redoStacks.set(key, stack);
      commitAnnotations(filtered, false);
    }
  };

  const saveDraftNote = useCallback(
    (noteToSave = draftNote) => {
      if (!noteToSave) return;
      const trimmed = (noteToSave.text || "").trim();
      if (trimmed) {
        const next = [
          ...annotationsRef.current.filter((it) => it.id !== noteToSave.id),
          {
            id: noteToSave.id,
            type: "text",
            x: noteToSave.x,
            y: noteToSave.y,
            text: trimmed,
            color: noteToSave.color || color,
            fontSize: noteToSave.fontSize || "md",
            noteStyle: noteToSave.noteStyle || "card",
          },
        ];
        commitAnnotations(next, true);
      }
      setDraftNote(null);
    },
    [draftNote, color, commitAnnotations]
  );

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

    // If an active draft note has text and user taps outside it on the page, auto-save it first
    if (draftNote) {
      if ((draftNote.text || "").trim()) {
        saveDraftNote(draftNote);
      } else {
        setDraftNote(null);
      }
      if (tool !== "text") return;
    }

    const { x, y } = getNormalizedCoords(e);

    if (tool === "text") {
      e.preventDefault();
      setViewingNote(null);
      setDraftNote({
        id: `txt_${Date.now()}`,
        x: Math.min(0.88, Math.max(0.12, x)),
        y: Math.min(0.9, Math.max(0.08, y)),
        text: "",
        color,
        fontSize: "md",
        noteStyle: "card",
        isExisting: false,
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

    if (laserFadeTimerRef.current) {
      clearInterval(laserFadeTimerRef.current);
      laserFadeTimerRef.current = null;
    }

    const effectiveSize =
      tool === "highlighter" ? Math.max(14, size * 3.8) : tool === "laser" ? 4.5 : size;

    const newStroke = {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: "stroke",
      tool,
      color,
      size: effectiveSize,
      alpha: 0.95,
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

    // Horizontal snap underline tool
    if (tool === "underline") {
      const startY = stroke.points[0][1];
      stroke.points = [stroke.points[0], [x, startY]];
      redrawCanvas(annotationsRef.current, stroke);
      return;
    }

    // For geometric shape tools (line, arrow, rect, circle), only keep [startPoint, currentPoint]
    if (tool === "line" || tool === "arrow" || tool === "rect" || tool === "circle") {
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
      // Laser pointer fades out automatically and does not save to storage
      if (stroke.tool === "laser") {
        let fadeAlpha = 0.95;
        if (laserFadeTimerRef.current) clearInterval(laserFadeTimerRef.current);
        laserFadeTimerRef.current = setInterval(() => {
          fadeAlpha -= 0.14;
          if (fadeAlpha <= 0) {
            clearInterval(laserFadeTimerRef.current);
            laserFadeTimerRef.current = null;
            redrawCanvas(annotationsRef.current, null);
          } else {
            redrawCanvas(annotationsRef.current, { ...stroke, alpha: fadeAlpha });
          }
        }, 45);
        return;
      }

      // Ignore accidental zero-length shape taps
      if (
        (stroke.tool === "line" ||
          stroke.tool === "underline" ||
          stroke.tool === "arrow" ||
          stroke.tool === "rect" ||
          stroke.tool === "circle") &&
        stroke.points.length < 2
      ) {
        redrawCanvas(annotationsRef.current, null);
        return;
      }
      const next = [...annotationsRef.current, stroke];
      commitAnnotations(next, true);
    }
  };

  // Dragging or tapping existing text notes on the page
  const startNoteDrag = (e, note) => {
    e.stopPropagation();
    if (!isDrawingActive) {
      // When Pen mode is off (or in Pan mode), tapping a note opens a clean read/view popover
      setViewingNote((prev) => (prev?.id === note.id ? null : note));
      return;
    }
    if (tool === "eraser") {
      deleteTextNote(note.id);
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    const { x, y } = getNormalizedCoords(e);
    drawingRef.current.draggingNoteId = note.id;
    drawingRef.current.notePointerId = e.pointerId;
    drawingRef.current.noteStartX = e.clientX;
    drawingRef.current.noteStartY = e.clientY;
    drawingRef.current.noteMoved = false;
    drawingRef.current.dragOffsetX = (note.x || 0.5) - x;
    drawingRef.current.dragOffsetY = (note.y || 0.5) - y;
  };

  const moveNoteDrag = (e) => {
    const noteId = drawingRef.current.draggingNoteId;
    if (!noteId) return;
    e.stopPropagation();
    const movePx = Math.hypot(
      e.clientX - drawingRef.current.noteStartX,
      e.clientY - drawingRef.current.noteStartY
    );
    if (movePx > 5) {
      drawingRef.current.noteMoved = true;
    }
    const { x, y } = getNormalizedCoords(e);
    const nextX = Math.max(0.08, Math.min(0.92, +(x + drawingRef.current.dragOffsetX).toFixed(4)));
    const nextY = Math.max(0.06, Math.min(0.94, +(y + drawingRef.current.dragOffsetY).toFixed(4)));
    const updated = annotationsRef.current.map((it) =>
      it.id === noteId ? { ...it, x: nextX, y: nextY } : it
    );
    setAnnotations(updated);
    annotationsRef.current = updated;
  };

  const endNoteDrag = (e, note) => {
    const noteId = drawingRef.current.draggingNoteId;
    if (!noteId) return;
    e?.stopPropagation?.();
    try {
      if (drawingRef.current.notePointerId !== null) {
        e?.currentTarget?.releasePointerCapture?.(drawingRef.current.notePointerId);
      }
    } catch {}
    const wasMoved = drawingRef.current.noteMoved;
    drawingRef.current.draggingNoteId = null;
    drawingRef.current.notePointerId = null;
    drawingRef.current.noteMoved = false;

    if (wasMoved) {
      savePageAnnotations(bookId, pageNumber, annotationsRef.current);
    } else if (note && isDrawingActive && tool !== "eraser") {
      setDraftNote({
        ...note,
        fontSize: note.fontSize || "md",
        noteStyle: note.noteStyle || "card",
        isExisting: true,
      });
    }
  };

  const deleteTextNote = (id) => {
    const next = annotationsRef.current.filter((it) => it.id !== id);
    if (viewingNote?.id === id) setViewingNote(null);
    if (draftNote?.id === id) setDraftNote(null);
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
        data-annot-canvas={pageNumber}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
        style={{
          touchAction: isDrawingActive ? "none" : "auto",
        }}
        className="w-full h-full block"
      />

      {/* Live Eraser Visual Square Box */}
      {isDrawingActive && tool === "eraser" && eraserPos && (
        <div
          style={{
            left: `${eraserPos.x * 100}%`,
            top: `${eraserPos.y * 100}%`,
            width: size >= 6 ? "44px" : size <= 2.5 ? "22px" : "32px",
            height: size >= 6 ? "44px" : size <= 2.5 ? "22px" : "32px",
          }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-rose-500 bg-rose-500/20 shadow-md"
        />
      )}

      {/* Target Pin Indicator while writing a new text note */}
      {draftNote && (
        <div
          style={{
            left: `${(draftNote.x || 0.5) * 100}%`,
            top: `${(draftNote.y || 0.5) * 100}%`,
            borderColor: resolveStrokeColor(draftNote.color || color, isDark),
            backgroundColor: resolveStrokeColor(draftNote.color || color, isDark),
          }}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full ring-4 ring-white/80 dark:ring-black/70 shadow-lg z-20 animate-pulse"
        />
      )}

      {/* Saved Text Notes on the Page (Always tappable to view even when Pen mode is closed) */}
      {textNotes.map((note) => {
        const resolvedNoteColor = resolveStrokeColor(note.color, isDark);
        const fontSizeClass =
          note.fontSize === "lg"
            ? "text-sm"
            : note.fontSize === "sm"
            ? "text-[11px]"
            : "text-xs";
        const isInline = note.noteStyle === "inline";

        return (
          <div
            key={note.id}
            data-viewer-ui
            onPointerDown={(e) => startNoteDrag(e, note)}
            onPointerMove={moveNoteDrag}
            onPointerUp={(e) => endNoteDrag(e, note)}
            onPointerCancel={(e) => endNoteDrag(e, note)}
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `${(note.x || 0.1) * 100}%`,
              top: `${(note.y || 0.1) * 100}%`,
              borderColor: isInline ? "transparent" : resolvedNoteColor,
              color: isInline ? resolvedNoteColor : undefined,
            }}
            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 max-w-[230px] font-bold leading-snug break-words transition-transform ${fontSizeClass} ${
              isDrawingActive
                ? "cursor-move hover:scale-105"
                : "cursor-pointer hover:scale-105"
            } ${
              isInline
                ? "px-2 py-1 rounded-lg bg-white/85 dark:bg-neutral-950/85 backdrop-blur-xs shadow-sm ring-1 ring-black/10 dark:ring-white/15"
                : isDark
                ? "px-2.5 py-1.5 rounded-xl border-2 shadow-lg bg-neutral-900/95 text-stone-100"
                : "px-2.5 py-1.5 rounded-xl border-2 shadow-lg bg-amber-50/95 text-stone-900"
            }`}
            dir="auto"
          >
            <div className="flex items-start gap-1.5">
              {isDrawingActive ? (
                <GripHorizontal
                  className="w-3.5 h-3.5 opacity-60 shrink-0 mt-0.5"
                  style={{ color: resolvedNoteColor }}
                />
              ) : (
                !isInline && (
                  <MessageSquare
                    className="w-3 h-3 shrink-0 mt-0.5"
                    style={{ color: resolvedNoteColor }}
                  />
                )
              )}
              <span className="flex-1 line-clamp-4 whitespace-pre-wrap">{note.text}</span>
              {isDrawingActive && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
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
        );
      })}

      {/* Read/Edit Note Modal when tapped while reading (Portal to body so never clipped or crowded) */}
      {viewingNote &&
        !draftNote &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-viewer-ui
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-x-0 top-14 z-[120] flex justify-center px-3 pointer-events-none"
            dir="rtl"
          >
            <div className="pointer-events-auto w-full max-w-md p-4 rounded-2xl bg-[#111622] text-white border border-slate-700 shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
                <span
                  className="text-sm font-bold flex items-center gap-1.5"
                  style={{ color: resolveStrokeColor(viewingNote.color, true) }}
                >
                  <MessageSquare className="w-4 h-4" />
                  {t.penNoteViewTitle || "ملاحظة الصفحة"}
                </span>
                <button
                  type="button"
                  onClick={() => setViewingNote(null)}
                  className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p
                dir="auto"
                className="text-base leading-relaxed text-stone-100 whitespace-pre-wrap break-words max-h-52 overflow-y-auto"
              >
                {viewingNote.text}
              </p>
              <div className="flex items-center justify-end gap-2 mt-3.5 pt-2.5 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => deleteTextNote(viewingNote.id)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300"
                >
                  {t.delete || "حذف"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftNote({
                      ...viewingNote,
                      fontSize: viewingNote.fontSize || "md",
                      noteStyle: viewingNote.noteStyle || "card",
                      isExisting: true,
                    });
                    setViewingNote(null);
                  }}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-primary text-primary-foreground"
                >
                  {t.penEditNoteBtn || "تعديل"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Spacious, Uncrowded Top-Docked Text Note Editor (Portal above page, safe from keyboard & toolbar) */}
      {draftNote &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-viewer-ui
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-x-0 top-3 sm:top-6 z-[120] flex justify-center px-3 pointer-events-none"
            dir="rtl"
          >
            <div
              style={{
                borderColor: resolveStrokeColor(draftNote.color || color, true),
              }}
              className="pointer-events-auto w-full max-w-md rounded-2xl bg-[#101624] text-white border-2 shadow-[0_20px_60px_rgba(0,0,0,0.9)] p-3.5 space-y-3"
            >
              {/* Clean Top Row: Title + Font Size (صغير / متوسط / كبير) + Style (بطاقة / نص) */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-200 flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: resolveStrokeColor(draftNote.color || color, true),
                    }}
                  />
                  {draftNote.isExisting
                    ? t.penEditNoteBtn || "تعديل النص"
                    : `كتابة نص (ص ${pageNumber})`}
                </span>

                <div className="flex items-center gap-1.5">
                  {/* Card vs Direct Text */}
                  <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                    <button
                      type="button"
                      onClick={() =>
                        setDraftNote((d) => (d ? { ...d, noteStyle: "card" } : null))
                      }
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                        (draftNote.noteStyle || "card") === "card"
                          ? "bg-primary text-primary-foreground"
                          : "text-slate-300"
                      }`}
                    >
                      بطاقة
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftNote((d) => (d ? { ...d, noteStyle: "inline" } : null))
                      }
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                        draftNote.noteStyle === "inline"
                          ? "bg-primary text-primary-foreground"
                          : "text-slate-300"
                      }`}
                    >
                      نص مباشر
                    </button>
                  </div>

                  {/* Font size */}
                  <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                    {NOTE_FONT_SIZES.map((fs) => (
                      <button
                        key={fs.id}
                        type="button"
                        onClick={() =>
                          setDraftNote((d) => (d ? { ...d, fontSize: fs.id } : null))
                        }
                        className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                          (draftNote.fontSize || "md") === fs.id
                            ? "bg-slate-600 text-white"
                            : "text-slate-400"
                        }`}
                      >
                        {fs.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Large, High-Contrast Writing Area so user clearly sees what they type */}
              <textarea
                autoFocus
                rows={3}
                dir="auto"
                value={draftNote.text}
                onChange={(e) =>
                  setDraftNote((d) => (d ? { ...d, text: e.target.value } : null))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveDraftNote(draftNote);
                  } else if (e.key === "Escape") {
                    setDraftNote(null);
                  }
                }}
                placeholder={t.penNotePlaceholder || "اكتب النص أو الفائدة هنا بوضوح..."}
                className="w-full bg-white text-stone-950 placeholder:text-stone-400 text-base sm:text-lg font-bold leading-relaxed rounded-xl p-3 border-2 border-slate-300 focus:outline-none focus:border-primary resize-y min-h-[96px] shadow-inner"
              />

              {/* Single Bottom Bar: 6 Clear Color Dots + Save / Cancel */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                {/* 6 Spacious Color Dots */}
                <div className="flex items-center gap-2">
                  {NOTE_COLORS.map((nc) => {
                    const isSelected =
                      (draftNote.color || color).toUpperCase() === nc.toUpperCase();
                    const displayBg = nc === "#111827" ? "#F9FAFB" : nc;
                    return (
                      <button
                        key={nc}
                        type="button"
                        onClick={() =>
                          setDraftNote((d) => (d ? { ...d, color: nc } : null))
                        }
                        className={`w-6.5 h-6.5 rounded-full shrink-0 transition-transform flex items-center justify-center ${
                          isSelected
                            ? "scale-115 ring-2 ring-white shadow-md"
                            : "opacity-80 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: displayBg }}
                      >
                        {isSelected && (
                          <Check
                            className="w-3.5 h-3.5 stroke-[3]"
                            style={{ color: nc === "#111827" ? "#111827" : "#FFFFFF" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5">
                  {draftNote.isExisting && (
                    <button
                      type="button"
                      onClick={() => deleteTextNote(draftNote.id)}
                      title={t.delete || "حذف"}
                      className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDraftNote(null)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    {t.cancel || "إلغاء"}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDraftNote(draftNote)}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 shadow-md"
                  >
                    <Check className="w-4 h-4" />
                    {t.penSaveNote || t.save || "حفظ"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
