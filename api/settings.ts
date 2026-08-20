import { assertMethod, handleError } from '../lib/server/errors.js'
import type { ApiRequest, ApiResponse } from '../lib/server/http.js'
import { zSettingsPatch } from '../lib/requests.js'
import { requireUser } from '../lib/server/session.js'
import { getSettings, updateSettings } from '../lib/server/users.js'

/** The only two user-configurable settings (functional spec §3.3). */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'PATCH'])
    const user = await requireUser(req, res)

    if (req.method === 'GET') {
      res.status(200).json({ settings: await getSettings(user.id) })
      return
    }

    const body = zSettingsPatch.parse(req.body)
    const settings = await updateSettings(user.id, {
      ...(body.daily_average_target !== undefined
        ? { daily_average_target: body.daily_average_target }
        : {}),
      ...(body.min_entries_for_valid_day !== undefined
        ? { min_entries_for_valid_day: body.min_entries_for_valid_day }
        : {}),
    })
    res.status(200).json({ settings })
  } catch (err) {
    return handleError(res, err, `${req.method} /api/settings`)
  }
}
