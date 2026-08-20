/** The response shapes the browser consumes. Kept in one file so no screen invents its own. */

export interface Factor {
  label: string
  reason: string
}

export interface Entry {
  id: string
  entry_date: string
  description: string
  is_homemade: boolean
  score: number
  rationale: string
  positive_factors: Factor[]
  negative_factors: Factor[]
  has_image: boolean
  created_at: string
  updated_at: string
}

export interface Settings {
  daily_average_target: number
  min_entries_for_valid_day: number
}

export interface SessionResponse {
  user: { id: string; email: string }
  is_admin: boolean
  debug: boolean
  settings: Settings
}

export interface AnalysisResponse {
  description: string
  score: number
  rationale: string
  positive_factors: Factor[]
  negative_factors: Factor[]
  food_detected: boolean
  cached: boolean
}

export interface DayMeta {
  count: number
  average: number
}

export interface EntriesPage {
  entries: Entry[]
  cursor: { entry_date: string; created_at: string } | null
  day_meta: Record<string, DayMeta>
}

export interface TrendPoint {
  date: string
  average: number | null
  count: number
}

export interface SummaryResponse {
  from: string
  to: string
  days: number
  target: number
  min_entries_for_valid_day: number
  trend: TrendPoint[]
  distribution: { score: number; count: number }[]
  period: {
    average: number | null
    daysOnTarget: number
    completeDays: number
    incompleteDays: number
    loggedDays: number
    meetsTarget: boolean | null
  }
}

export interface AllowlistRow {
  email: string
  blocked: boolean
  added_at: string
  has_signed_in: boolean
}

/**
 * The admin user row.
 *
 * There is deliberately no field here that could carry a description, image key,
 * score or rationale, so "no admin screen shows food data" is enforced by the
 * compiler rather than by discipline.
 */
export interface AdminUser {
  email: string
  has_signed_in: boolean
  entry_count: number
}

export interface PromptRow {
  key: 'image_analysis_prompt' | 'scoring_prompt'
  body: string
  version: number
  updated_at: string
  updated_by: string | null
  can_revert: boolean
}
