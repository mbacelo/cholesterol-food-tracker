import { ApiError } from './errors.js'

/**
 * Image byte validation, for the ONE endpoint that accepts an image:
 * /api/analyze.
 *
 * Photos are transient (tech spec §6). They are compressed on the device, sent
 * to the model, shown while the Log flow is open, and then discarded -- nothing
 * is persisted, so there is no object store and no bucket to configure. What
 * still matters is that the bytes we hand to a provider are actually an image of
 * a type we support, and that they are small enough to be worth sending.
 */

const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number]

/** tech spec §6: decoded size cap, checked independently of what the client claims. */
export const MAX_DECODED_BYTES = 3_500_000

/** Validates the declared type against the actual bytes. */
export function assertImageBytes(bytes: Buffer, declared: string): void {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(declared)) {
    throw new ApiError(400, 'bad_request', 'unsupported image type', true)
  }
  if (bytes.length > MAX_DECODED_BYTES) {
    throw new ApiError(413, 'payload_too_large')
  }
  // A declared content type is just a claim, so check the magic bytes. This is
  // what stops a renamed executable being forwarded to a provider as a .jpg.
  const actual = sniff(bytes)
  if (actual === null || actual !== declared) {
    throw new ApiError(400, 'bad_request', 'image bytes do not match the declared type', true)
  }
}

function sniff(bytes: Buffer): ImageContentType | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}
