import { BarChart3, CalendarDays, History, Plus, User } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { FlaskConical } from 'lucide-react'
import { useSession } from '@/context/SessionContext'
import { OfflineBanner } from './ui'
import { hasDraft } from '@/routes/Log/captureStorage'

const ITEMS = [
  { to: '/today', label: 'Hoy', Icon: CalendarDays },
  { to: '/history', label: 'Historial', Icon: History },
  { to: '/log', label: 'Registrar', Icon: Plus, primary: true },
  { to: '/dashboard', label: 'Panel', Icon: BarChart3 },
  { to: '/me', label: 'Perfil', Icon: User },
] as const

/**
 * Five destinations, persistent (functional spec §5).
 *
 * One definition, two placements: a bottom bar on a phone where a thumb can
 * reach it, a top bar from md up. `pb-safe` keeps it clear of the iPhone home
 * indicator.
 */
function NavItems({ vertical = false }: { vertical?: boolean }) {
  const draft = hasDraft()
  return (
    <>
      {ITEMS.map(({ to, label, Icon, ...rest }) => {
        const primary = 'primary' in rest && rest.primary
        return (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium ${
                vertical ? 'flex-row gap-2 px-3' : ''
              } ${isActive ? 'text-slate-900' : 'text-slate-500'}`
            }
          >
            <span className="relative">
              <Icon
                className={primary ? 'size-7 rounded-full bg-slate-900 p-1 text-white' : 'size-5'}
                aria-hidden="true"
              />
              {primary && draft ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-slate-50"
                />
              ) : null}
            </span>
            {label}
          </NavLink>
        )
      })}
    </>
  )
}

/**
 * Debug-mode indicator (functional spec §2.1).
 *
 * Keyed off import.meta.env.DEV, which is statically false in any deployed
 * build, so this is unshippable by construction -- the whole component is
 * eliminated from the production bundle.
 */
function DebugBanner() {
  if (!import.meta.env.DEV) return null
  const { state } = useSession()
  if (state.status !== 'ready' || !state.debug) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950"
    >
      <FlaskConical className="size-3.5" aria-hidden="true" />
      SESIÓN DEBUG · {state.user.email}
      {state.isAdmin ? ' · admin' : ''}
    </div>
  )
}

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <DebugBanner />
      <OfflineBanner />
      <nav
        aria-label="Principal"
        className="hidden border-b border-slate-200 bg-white md:flex md:items-center md:gap-2 md:px-4 md:py-2"
      >
        <NavItems vertical />
      </nav>

      {/* pb-24 so the last row is never trapped under the bottom bar. */}
      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-2 md:pb-8">
        <Outlet />
      </main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-safe pt-1 backdrop-blur md:hidden"
      >
        <NavItems />
      </nav>
    </div>
  )
}

export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex items-baseline gap-3 py-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  )
}
