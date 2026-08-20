import { assertMethod, handleError } from '../../lib/server/errors.js'
import type { ApiRequest, ApiResponse } from '../../lib/server/http.js'
import { requireAdmin } from '../../lib/server/session.js'

/**
 * The admin probe (tech spec §5).
 *
 * The client cannot read ADMIN_EMAILS, so it calls this once per sign-in: 200
 * means administrator, anything else means not. A 403 here is the NORMAL path
 * for every ordinary user and must never surface as an error in the UI.
 *
 * A dedicated endpoint rather than probing admin/allowlist: that would run a
 * query for an answer we throw away, and would couple the probe to a data shape.
 *
 * Hiding the menu item is a convenience. The boundary is requireAdmin(), re-run
 * on every admin action.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET'])
    await requireAdmin(req, res)
    res.status(200).json({ admin: true })
  } catch (err) {
    return handleError(res, err, 'GET /api/admin/ping')
  }
}
