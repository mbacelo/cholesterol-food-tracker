import { z } from 'zod'
import { assertMethod, handleError } from '../../lib/server/errors.js'
import type { ApiRequest, ApiResponse } from '../../lib/server/http.js'
import { requireAdmin } from '../../lib/server/session.js'
import { PROMPT_KEYS, getPrompts, revertPrompt, savePrompt } from '../../lib/server/prompts.js'

const zKey = z.enum(PROMPT_KEYS)
const zSave = z.object({ key: zKey, body: z.string().min(20).max(40_000) }).strict()
const zAction = z.object({ key: zKey, action: z.literal('revert') }).strict()

/**
 * The prompt editor (functional spec §6.9).
 *
 * Saving affects FUTURE analyses only; existing entries are never re-scored. That
 * is not enforced by discipline here -- it falls out of the design: scores are
 * stored on the row, and the cache key includes the prompt version, so a bump
 * invalidates the cache for new work while every stored score stays put.
 *
 * Revert swaps body and previous_body, so a revert is itself revertible.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    assertMethod(res, req.method, ['GET', 'PUT', 'POST'])
    const admin = await requireAdmin(req, res)

    if (req.method === 'GET') {
      const prompts = await getPrompts()
      res.status(200).json({
        prompts: PROMPT_KEYS.map((key) => ({
          key,
          body: prompts[key].body,
          version: prompts[key].version,
          updated_at: prompts[key].updated_at,
          updated_by: prompts[key].updated_by,
          // The client only needs to know whether Revert is available, not what
          // the previous text was.
          can_revert: prompts[key].previous_body !== null,
        })),
      })
      return
    }

    if (req.method === 'PUT') {
      const { key, body } = zSave.parse(req.body)
      const row = await savePrompt(key, body, admin.email)
      res.status(200).json({ prompt: publicRow(row) })
      return
    }

    const { key } = zAction.parse(req.body)
    const row = await revertPrompt(key, admin.email)
    res.status(200).json({ prompt: publicRow(row) })
  } catch (err) {
    return handleError(res, err, `${req.method} /api/admin/prompts`)
  }
}

function publicRow(row: {
  key: string
  body: string
  previous_body: string | null
  version: number
  updated_at: string
  updated_by: string | null
}) {
  return {
    key: row.key,
    body: row.body,
    version: row.version,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    can_revert: row.previous_body !== null,
  }
}
