import { cookies } from "next/headers"
import { LoginForm } from "./LoginForm"
import { CostDashboard } from "./CostDashboard"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminCostsPage() {
  const adminPassword = process.env.ADMIN_PASSWORD
  const cookieStore = await cookies()
  const token = cookieStore.get("admin_session")?.value
  const authed = Boolean(adminPassword && token === adminPassword)

  if (!adminPassword) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Admin not configured</h1>
          <p className="text-white/70 text-sm">
            Set <code className="bg-white/10 px-1.5 py-0.5 rounded">ADMIN_PASSWORD</code> in
            your environment, restart the server, then reload this page.
          </p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <LoginForm />
      </div>
    )
  }

  return <CostDashboard />
}
