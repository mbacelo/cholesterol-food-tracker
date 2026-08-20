import { z } from 'zod'
import { remove as removeBlobs } from '../../lib/server/blob.js'
import { countEntriesForUser } from '../../lib/server/entries.js'
import { assertMethod, handleError } from '../../lib/server/errors.js'
import { ApiError } from '../../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../../lib/server/http.js'
import { zEmail } from '../../lib/requests.js'
import { requireAdmin } from '../../lib/server/session.js'
import { deleteUserById, findUserByEmail } from '../../lib/server/users.js'

const zDelete = z.object({ confirm_entry_count: z.number().int().min(0) }).strict()

/**
 * User inspection and deletion (functional spec §6.9).
 *
 * The administrator can learn exactly one thing about someone's food data: HOW
 * MANY entries there are. A count is not content, and it is what the deletion
 * confirmation needs in order to state the consequence honestly. No response
 * from this file can carry a description, image key, score or rationale.
 *
 * Deletion order: photos first, then the row. `on delete cascade` removes the
 * entries, and the R2 prefix delete removes the images. Doing the blobs first
 * means a failure leaves orphaned rows we can still find and retry, rather than
 * orphaned objects we no longer have keys for.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'DELETE'])
    await requireAdmin(req, res)

    const email = zEmail.parse(queryParam(req, 'email'))
    const user = await findUserByEmail(email)

    if (req.method === 'GET') {
      // A person on the allowlist who has never signed in has no user row and
      // therefore no data. That is not an error.
      res.status(200).json({
        email,
        has_signed_in: user !== null,
        entry_count: user ? await countEntriesForUser(user.id) : 0,
      })
      return
    }

    if (!user) throw new ApiError(404, 'not_found')

    const actual = await countEntriesForUser(user.id)
    const { confirm_entry_count } = zDelete.parse(req.body)
    // The count the administrator confirmed must still match. If entries were
    // added since the confirmation was shown, the destruction they agreed to is
    // not the one that would happen.
    if (confirm_entry_count !== actual) {
      throw new ApiError(409, 'conflict', 'entry count changed; reload and confirm again', true)
    }

    const deletedObjects = await removeBlobs(`${user.id}/`).catch((err) => {
      console.error('[admin/users] failed to remove blobs', err)
      return 0
    })
    await deleteUserById(user.id)

    res.status(200).json({ deleted_entries: actual, deleted_objects: deletedObjects })
  } catch (err) {
    return handleError(res, err, `${req.method} /api/admin/users`)
  }
}
