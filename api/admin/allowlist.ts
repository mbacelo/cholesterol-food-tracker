import {
  addEmail,
  listAllowlist,
  removeEmail,
  setBlocked,
} from '../../lib/server/allowlist.js'
import { assertMethod, handleError } from '../../lib/server/errors.js'
import { queryParam, type ApiRequest, type ApiResponse } from '../../lib/server/http.js'
import { zEmail } from '../../lib/requests.js'
import { requireAdmin } from '../../lib/server/session.js'
import { z } from 'zod'

const zAdd = z.object({ email: zEmail }).strict()
const zBlock = z.object({ email: zEmail, blocked: z.boolean() }).strict()

/**
 * Allowlist management (functional spec §6.9).
 *
 * Contains no food data of any kind. The rows carry an email, a blocked flag and
 * whether that person has ever signed in -- there is no field here that could
 * hold a description, image key, score or rationale.
 *
 * DELETE removes the allowlist row only. It revokes access on the person's next
 * request; it does NOT delete their data. Destroying data is admin/users.ts, and
 * the two are deliberately separate operations with different wording, because
 * confusing them is irreversible.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'POST', 'PATCH', 'DELETE'])
    await requireAdmin(req, res)

    switch (req.method) {
      case 'GET': {
        res.status(200).json({ allowlist: await listAllowlist() })
        return
      }
      case 'POST': {
        const { email } = zAdd.parse(req.body)
        res.status(201).json({ row: await addEmail(email) })
        return
      }
      case 'PATCH': {
        const { email, blocked } = zBlock.parse(req.body)
        // The allowlist cache is invalidated inside setBlocked, so a block takes
        // effect on this instance immediately and elsewhere within 60 seconds.
        res.status(200).json({ row: await setBlocked(email, blocked) })
        return
      }
      default: {
        await removeEmail(zEmail.parse(queryParam(req, 'email')))
        res.status(204).send('')
        return
      }
    }
  } catch (err) {
    return handleError(res, err, `${req.method} /api/admin/allowlist`)
  }
}
