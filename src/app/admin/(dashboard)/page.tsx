import { getDashboardData } from "@/lib/dashboard";
import { Dashboard } from "@/components/admin/Dashboard";

export const dynamic = "force-dynamic";

// The admin home is the dashboard. Data is assembled on the server for the
// first paint and then owned by TanStack Query on the client, which refetches
// it from /api/admin/dashboard on a timer and on demand.

export default async function AdminHome() {
  const initial = await getDashboardData();
  return <Dashboard initial={initial} />;
}
