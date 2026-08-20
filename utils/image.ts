/**
 * Client-side image compression (tech spec §6).
 *
 * The original full-resolution file is NEVER uploaded. A canvas downscale to
 * 1280px at JPEG ~0.7 lands around 200-400 KB while keeping enough detail for
 * the model to identify a dish -- which matters, because the fine texture cues
 * (visible cheese, a sauce sheen, breadcrumb grain) are exactly what drives the
 * score.
 *
 * A free privacy win worth stating: re-encoding through a canvas strips ALL EXIF,
 * including GPS coordinates. The original file, with its location metadata, never
 * leaves the device.
 */

export const MAX_EDGE = 1280
export const JPEG_QUALITY = 0.7
export const TARGET_MAX_BYTES = 400_000
/** The server's decoded-size cap. */
export const HARD_MAX_BYTES = 3_500_000
/** Refuse absurd input before spending time decoding it. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024

export type ImageErrorCode = 'unsupported' | 'decode_failed' | 'too_large' | 'encode_failed'

export class ImageError extends Error {
  readonly code: ImageErrorCode
  constructor(code: ImageErrorCode, message: string) {
    super(message)
    this.name = 'ImageError'
    this.code = code
  }
}

export interface CompressedImage {
  /** Raw base64, with no data: URL prefix -- that is the wire format. */
  base64: string
  /** A data: URL, for <img src> and for the localStorage draft. */
  dataUrl: string
  contentType: 'image/jpeg'
  bytes: number
  width: number
  height: number
  originalBytes: number
  attempts: number
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageError('too_large', 'Esa imagen es demasiado grande para procesarla.')
  }

  const bitmap = await decode(file)
  try {
    let maxEdge = MAX_EDGE
    let quality = JPEG_QUALITY
    let attempts = 0
    let best: { blob: Blob; width: number; height: number } | null = null

    // Step down quality, then resolution, rather than either alone: dropping
    // quality far enough to hit the target destroys the texture the model reads.
    const ladder: { maxEdge: number; quality: number }[] = [
      { maxEdge, quality },
      { maxEdge, quality: 0.6 },
      { maxEdge: 1024, quality: 0.55 },
    ]

    for (const step of ladder) {
      attempts += 1
      maxEdge = step.maxEdge
      quality = step.quality
      const drawn = draw(bitmap, maxEdge)
      const blob = await toJpeg(drawn.canvas, quality)
      best = { blob, width: drawn.width, height: drawn.height }
      if (blob.size <= TARGET_MAX_BYTES) break
    }

    if (!best) throw new ImageError('encode_failed', 'No se pudo procesar esa foto.')
    if (best.blob.size > HARD_MAX_BYTES) {
      throw new ImageError('too_large', 'Esa foto sigue siendo muy grande incluso comprimida.')
    }

    const dataUrl = await blobToDataUrl(best.blob)
    return {
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      dataUrl,
      contentType: 'image/jpeg',
      bytes: best.blob.size,
      width: best.width,
      height: best.height,
      originalBytes: file.size,
      attempts,
    }
  } finally {
    if (typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close()
  }
}

type Decoded = ImageBitmap | (HTMLImageElement & { close?: never })

/**
 * Decodes with EXIF orientation applied.
 *
 * `imageOrientation: 'from-image'` is the whole EXIF story on mobile -- the
 * browser applies the orientation tag during decode, so no exif parsing library
 * is needed. A phone photo taken in portrait would otherwise arrive rotated 90
 * degrees, and the model would be reading a sideways plate.
 */
async function decode(file: File): Promise<Decoded> {
  try {
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    }
  } catch {
    // Fall through to the element path.
  }

  try {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img as Decoded
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    // The realistic case is an iPhone HEIC picked from the gallery on a browser
    // that cannot decode it. That must read as an unsupported format, not a crash.
    throw new ImageError('decode_failed', 'Ese formato de foto no es compatible.')
  }
}

function draw(source: Decoded, maxEdge: number): { canvas: HTMLCanvasElement; width: number; height: number } {
  const sourceWidth = 'width' in source ? source.width : 0
  const sourceHeight = 'height' in source ? source.height : 0
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new ImageError('encode_failed', 'No se pudo procesar esa foto.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source as CanvasImageSource, 0, 0, width, height)
  return { canvas, width, height }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new ImageError('encode_failed', 'No se pudo procesar esa foto.'))
      },
      'image/jpeg',
      quality,
    )
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageError('encode_failed', 'No se pudo leer esa foto.'))
    reader.readAsDataURL(blob)
  })
}
