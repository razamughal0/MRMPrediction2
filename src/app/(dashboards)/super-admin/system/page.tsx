import { DashboardShell } from "../../dashboard-shell";
import { ComingSoon } from "@/components/coming-soon";
import { Cog } from "lucide-react";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <DashboardShell role="super_admin" title="System Configuration">
      <ComingSoon
        title="System Configuration"
        description="Platform settings and feature flags."
        icon={<Cog className="h-7 w-7" />}
        backHref="/super-admin"
        backLabel="Back to dashboard"
        features={["Feature flags","AI settings","Email configuration","Backup settings"]}
      />
    </DashboardShell>
  );
}
