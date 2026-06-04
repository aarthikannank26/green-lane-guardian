import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/hospital")({
  head: () => ({ meta: [{ title: "Hospital Dashboard" }] }),
  component: () => (
    <RoleGate role="hospital">
      <HospitalDashboard />
    </RoleGate>
  ),
});

function HospitalDashboard() {
  return (
    <DashboardShell title="Hospital Dashboard" subtitle="Incoming ambulances">
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <Building2 className="size-6 text-accent" />
          <p className="font-semibold">Incoming Ambulances</p>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Live list of ambulances heading to your hospital with map and ETAs (Phase 4).
        </p>
      </div>
    </DashboardShell>
  );
}
