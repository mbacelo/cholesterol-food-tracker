import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { SessionProvider, useSession } from '@/context/SessionContext'
import { AppShell } from '@/components/shell'
import { ErrorState, Spinner } from '@/components/ui'
import Today from '@/routes/Today'
import Log from '@/routes/Log/index'
import History from '@/routes/History'
import EntryDetail from '@/routes/EntryDetail'
import Me from '@/routes/Me'
import Rubric from '@/routes/Rubric'
import Login, { NotAuthorized } from '@/routes/Login'
import { AdminLayout, AdminPrompts, AdminUsers } from '@/routes/admin/Admin'

// Recharts is ~400 KB of the bundle and only the dashboard needs it. Splitting it
// out keeps the logging path -- the one that has to feel instant -- small.
const Dashboard = lazy(() => import('@/routes/Dashboard'))

/**
 * The route tree. react-router v7 declarative mode: BrowserRouter plus
 * Routes/Route, with no data router -- every screen is authenticated and
 * interactive, so loaders buy nothing here.
 */

/**
 * The session gate.
 *
 * `loading` renders a spinner rather than redirecting, so there is no flash of
 * the login screen for a signed-in user. A bootstrap network failure renders an
 * error with a retry, NOT a redirect to login: a flaky tunnel must not look like
 * a sign-out.
 */
function RequireSession() {
  const { state, retry } = useSession()
  const location = useLocation()

  switch (state.status) {
    case 'loading':
      return (
        <div className="grid min-h-dvh place-items-center">
          <Spinner label="Loading your account" />
        </div>
      )
    case 'anonymous':
      return <Navigate to="/login" replace state={{ next: location.pathname }} />
    case 'not_authorized':
      return <Navigate to="/not-authorized" replace />
    case 'error':
      return (
        <div className="mx-auto max-w-sm px-6 py-16">
          <ErrorState message={state.message} onRetry={retry} />
        </div>
      )
    default:
      return <AppShell />
  }
}

/**
 * The admin gate.
 *
 * Needs no loading branch: the probe resolves as part of the same bootstrap as
 * the session, so `isAdmin` is already a settled boolean here. A non-admin is
 * bounced to Me rather than shown an error, because not being an administrator is
 * the ordinary case.
 */
function RequireAdmin() {
  const { state } = useSession()
  if (state.status !== 'ready') return null
  if (!state.isAdmin) return <Navigate to="/me" replace />
  return <AdminLayout />
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/not-authorized" element={<NotAuthorized />} />

        <Route element={<RequireSession />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="today" element={<Today />} />
          <Route path="log" element={<Log />} />
          <Route path="history" element={<History />} />
          <Route path="entry/:id" element={<EntryDetail />} />
          <Route
            path="dashboard"
            element={
              <Suspense
                fallback={
                  <div className="grid min-h-64 place-items-center">
                    <Spinner label="Loading charts" />
                  </div>
                }
              >
                <Dashboard />
              </Suspense>
            }
          />
          <Route path="me" element={<Me />} />
          <Route path="rubric" element={<Rubric />} />

          <Route path="admin" element={<RequireAdmin />}>
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="prompts" element={<AdminPrompts />} />
          </Route>

          <Route path="*" element={<Navigate to="/today" replace />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
