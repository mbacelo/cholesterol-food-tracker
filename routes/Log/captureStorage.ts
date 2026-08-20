import type { AnalysisResponse } from '@/types/api'

/**
 * In-progress capture persistence (tech spec §8).
 *
 * A refresh mid-review must NOT trigger a second paid analysis. That is an
 * acceptance criterion, and it is the entire reason this module exists.
 *
 * TWO KEYS, deliberately. The image is ~530 KB of base64 and changes once per
 * photo; the draft is small and rewritten on every keystroke. One combined key
 * would re-serialize half a megabyte per character typed, which is visible jank
 * on a mid-range phone.
 */

/** Bump on ANY shape change below. Stale data is discarded, never rehydrated. */
export const SESSION_VERSION = 1

const KEY_IMAGE = 'ft.capture.image'
const KEY_DRAFT = 'ft.capture.draft'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface StoredImage {
  dataUrl: string
  base64: string
  contentType: 'image/jpeg'
  bytes: number
}

export interface StoredDraft {
  source: 'camera' | 'gallery' | 'typed'
  description: string
  isHomemade: boolean
  entryDate: string
  analysis: AnalysisResponse | null
  /** Hash of the inputs that produced `analysis`, so "dirty" is knowable. */
  scoredHash: string | null
}

interface Envelope<T> {
  v: number
  at: number
  data: T
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Envelope<T>
    // A version mismatch or an expired draft is discarded rather than
    // rehydrated: a shape change after a deploy must not crash the review screen.
    if (parsed.v !== SESSION_VERSION) return null
    if (Date.now() - parsed.at > MAX_AGE_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function write<T>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ v: SESSION_VERSION, at: Date.now(), data }))
    return true
  } catch {
    // QuotaExceededError. The caller decides what to tell the user; the
    // expensive artifact (the analysis) is in the other, much smaller key.
    return false
  }
}

export function saveImage(image: StoredImage): boolean {
  return write(KEY_IMAGE, image)
}

export function saveDraft(draft: StoredDraft): boolean {
  return write(KEY_DRAFT, draft)
}

export function loadCapture(): { image: StoredImage | null; draft: StoredDraft | null } {
  const image = read<StoredImage>(KEY_IMAGE)
  const draft = read<StoredDraft>(KEY_DRAFT)
  // If either side is stale, drop both: a draft referring to an image that is no
  // longer there is worse than starting over.
  if ((image === null) !== (draft === null) && draft?.source === 'typed') {
    return { image: null, draft }
  }
  return { image, draft }
}

export function clearCapture(): void {
  try {
    localStorage.removeItem(KEY_IMAGE)
    localStorage.removeItem(KEY_DRAFT)
  } catch {
    // Nothing useful to do.
  }
}

/** Whether a draft exists, for the nav dot. Cheap enough to call on render. */
export function hasDraft(): boolean {
  try {
    return localStorage.getItem(KEY_DRAFT) !== null
  } catch {
    return false
  }
}

/**
 * The inputs that determine a score.
 *
 * Normalized the same way the server normalizes its cache key, so re-typing the
 * same words with different spacing is not treated as a change.
 */
export function inputHash(description: string, isHomemade: boolean): string {
  return `${description.trim().replace(/\s+/g, ' ').toLowerCase()}|${isHomemade}`
}
