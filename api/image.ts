import { blobConfigured, readLocal, signedUrl } from '../lib/server/blob.js'
import { getEntryImageKey } from '../lib/server/entries.js'
import { assertMethod, handleError } from '../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../lib/server/http.js'
import { zUuid } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'

/** Presigned URL lifetime. Short, because the URL is a bearer credential. */
const TTL_SECONDS = 300

/**
 * Serves an entry's photo.
 *
 * Authenticates, confirms the row belongs to the caller, then 302s to a
 * presigned URL. A plain <img src> therefore works with no client JavaScript,
 * while the bucket stays private.
 *
 * Ownership is checked in Postgres, not inferred from the key's {user_id}/
 * prefix -- the prefix is organizational only. Another user's entry id returns
 * 404, indistinguishable from a nonexistent one.
 *
 * Cache-Control is just under the presign TTL: without it every re-render of the
 * same thumbnail costs a function invocation.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET'])
    const user = await requireUser(req, res)

    const entryId = zUuid.parse(queryParam(req, 'entry'))
    const key = await getEntryImageKey(user.id, entryId)

    if (!blobConfigured()) {
      // Local development: there is nothing to presign, so stream the file the
      // local store holds. Production never takes this path.
      const bytes = readLocal(key)
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'private, max-age=240')
      res.status(200).send(bytes)
      return
    }

    const url = await signedUrl(key, TTL_SECONDS)
    res.setHeader('Cache-Control', 'private, max-age=240')
    res.redirect(302, url)
  } catch (err) {
    return handleError(res, err, 'GET /api/image')
  }
}
