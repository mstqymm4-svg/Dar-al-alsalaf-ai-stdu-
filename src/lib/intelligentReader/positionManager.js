/**
 * DAR AL TAWHID — Exact Reading Position Manager (نظام حفظ موضع القراءة — القسم 11)
 *
 * Persists exact reading & audio position per user and per book:
 * - bookId, fileVersion
 * - pageNumber, paragraphIndex, sentenceIndex, wordIndex, charOffset
 * - audioTimeSec, language, playbackRate, selectedUrduVoice, selectedArabicVoice
 * - playerState, displayMode
 */

import { getAccountEmail } from "@/lib/activeUser";

function getPositionKey(bookId, userEmail) {
  const email = String(userEmail || getAccountEmail() || "guest@local")
    .trim()
    .toLowerCase();
  return `dat_reader_position::${email}::${String(bookId || "unknown")}`;
}

export function computeFileFingerprint(book) {
  if (!book) return "v1";
  const urlPart = String(book.pdf_url || book.id || "");
  const updatedPart = String(book.updated_date || book.page_count || "1");
  return `${urlPart.slice(-32)}_${updatedPart}`;
}

export function saveReadingPosition(bookId, state, userEmail) {
  if (!bookId) return null;
  try {
    const key = getPositionKey(bookId, userEmail);
    const existing = loadReadingPosition(bookId, userEmail) || {};
    const record = {
      ...existing,
      ...state,
      bookId: String(bookId),
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function loadReadingPosition(bookId, userEmail) {
  if (!bookId) return null;
  try {
    const key = getPositionKey(bookId, userEmail);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearReadingPosition(bookId, userEmail) {
  if (!bookId) return;
  try {
    const key = getPositionKey(bookId, userEmail);
    localStorage.removeItem(key);
  } catch {}
}

export function hasSavedResumePoint(book, userEmail) {
  if (!book?.id) return null;
  const pos = loadReadingPosition(book.id, userEmail);
  if (!pos) return null;
  const currentVersion = computeFileFingerprint(book);
  const versionChanged = Boolean(pos.fileVersion && pos.fileVersion !== currentVersion);

  // Consider it a meaningful resume point if page > 1 or sentenceIndex > 0 or wordIndex > 0
  if (
    (pos.pageNumber && pos.pageNumber > 1) ||
    (pos.sentenceIndex && pos.sentenceIndex > 0) ||
    (pos.wordIndex && pos.wordIndex > 0) ||
    (pos.audioTimeSec && pos.audioTimeSec > 1)
  ) {
    return {
      ...pos,
      versionChanged,
    };
  }
  return null;
}
