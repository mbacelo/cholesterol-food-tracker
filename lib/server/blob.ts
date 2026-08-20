import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { AwsClient } from 'aws4fetch'
import { isLocalEnvironment } from './env.js'
import { ApiError, ConfigError } from './errors.js'

/**
 * The ONLY file that knows an object store exists (tech spec §6).
 *
 * Production is Cloudflare R2: a private bucket, so photos are never publicly
 * reachable, and free egress, which suits images that are viewed repeatedly.
 * Changing providers later is a change to this one file.
 *
 * Locally, when R2 is not configured, objects go to .dev-blobs/ instead, and
 * `signedUrl` returns a path served by the dev-only /api/image handler. That is
 * what lets the photo path be built and exercised without a Cloudflare account.
 * As with the database, the fallback is refused outright when deployed.
 *
 * aws4fetch rather than @aws-sdk/client-s3 + s3-request-presigner: ~5 KB with no
 * dependencies against ~2-3 MB and dozens, and this module is imported by
 * /api/image, which runs on every photo render. The only thing the AWS SDK would
 * really buy is the prefix delete, which runs once per user deletion over keys we
 * generate ourselves.
 */

const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number]

/** tech spec §6: decoded size cap, checked independently of what the client claims. */
export const MAX_DECODED_BYTES = 3_500_000

const LOCAL_DIR = '.dev-blobs'

export function entryImageKey(userId: string, entryId: string): string {
  // The {user_id}/ prefix is organizational, not a security control: ownership is
  // always verified in Postgres before a URL is signed.
  return `${userId}/${entryId}.jpg`
}

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

export function blobConfigured(): boolean {
  return r2Config() !== null
}

let client: AwsClient | undefined

function awsClient(config: R2Config): AwsClient {
  // service and region MUST be passed explicitly: an
  // *.r2.cloudflarestorage.com hostname encodes neither, and aws4fetch would
  // otherwise try to infer them from the host and sign incorrectly.
  client ??= new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  return client
}

function objectUrl(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`
}

function localPath(key: string): string {
  return resolve(process.cwd(), LOCAL_DIR, key)
}

function requireLocalFallback(): void {
  if (!isLocalEnvironment()) {
    throw new ConfigError('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are required')
  }
}

/** Validates the declared type against the actual bytes. */
export function assertImageBytes(bytes: Buffer, declared: string): void {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(declared)) {
    throw new ApiError(400, 'bad_request', 'unsupported image type', true)
  }
  if (bytes.length > MAX_DECODED_BYTES) {
    throw new ApiError(413, 'payload_too_large')
  }
  // A declared content type is just a claim, so check the magic bytes. This is
  // what stops a renamed executable being stored as a .jpg.
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

export async function put(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const config = r2Config()
  if (!config) {
    requireLocalFallback()
    const path = localPath(key)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    return
  }

  const response = await awsClient(config).fetch(objectUrl(config, key), {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': contentType },
  })
  if (!response.ok) {
    // Log the provider's message; never return it.
    console.error('[blob] R2 put failed', response.status, await response.text().catch(() => ''))
    throw new ApiError(502, 'internal_error')
  }
}

/**
 * A presigned GET URL.
 *
 * TTL is short (5 minutes for /api/image) because the URL is a bearer credential
 * for that object: anyone holding it can read the photo until it expires.
 */
export async function signedUrl(key: string, ttlSeconds: number): Promise<string> {
  const config = r2Config()
  if (!config) {
    requireLocalFallback()
    // Locally there is nothing to presign; /api/image streams the file instead.
    return `local:${key}`
  }

  const url = new URL(objectUrl(config, key))
  url.searchParams.set('X-Amz-Expires', String(ttlSeconds))
  const signed = await awsClient(config).sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  })
  return signed.url
}

/** Reads an object's bytes. Local fallback only; production redirects instead. */
export function readLocal(key: string): Buffer {
  requireLocalFallback()
  try {
    return readFileSync(localPath(key))
  } catch {
    throw new ApiError(404, 'not_found')
  }
}

/**
 * Removes one object, or every object under a prefix when the key ends in '/'.
 *
 * The prefix form is used once per user deletion. Keys are uuid/uuid.jpg, which
 * we generate ourselves, so the XML Key scan below cannot meet an escapable
 * character.
 */
export async function remove(keyOrPrefix: string): Promise<number> {
  const config = r2Config()
  if (!config) {
    requireLocalFallback()
    const path = localPath(keyOrPrefix)
    try {
      if (keyOrPrefix.endsWith('/')) {
        const count = readdirSync(path).length
        rmSync(path, { recursive: true, force: true })
        return count
      }
      rmSync(path, { force: true })
      return 1
    } catch {
      return 0
    }
  }

  if (!keyOrPrefix.endsWith('/')) {
    const response = await awsClient(config).fetch(objectUrl(config, keyOrPrefix), {
      method: 'DELETE',
    })
    return response.ok ? 1 : 0
  }

  let removed = 0
  let continuation: string | undefined
  do {
    const listUrl = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`)
    listUrl.searchParams.set('list-type', '2')
    listUrl.searchParams.set('prefix', keyOrPrefix)
    if (continuation) listUrl.searchParams.set('continuation-token', continuation)

    const listed = await awsClient(config).fetch(listUrl.toString(), { method: 'GET' })
    if (!listed.ok) {
      console.error('[blob] R2 list failed', listed.status)
      break
    }
    const xml = await listed.text()
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]!)

    for (const key of keys) {
      const deleted = await awsClient(config).fetch(objectUrl(config, key), { method: 'DELETE' })
      if (deleted.ok) removed += 1
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    continuation = truncated
      ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? undefined)
      : undefined
  } while (continuation)

  return removed
}

/** Resets the memoized client. Tests only. */
export function resetBlobClient(): void {
  client = undefined
}
