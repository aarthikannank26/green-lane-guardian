import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { Ambulance, MapPin, Activity } from "lucide-react";

export const Route = createFileRoute("/driver")({
  head: () => ({ meta: [{ title: "Driver Dashboard" }] }),
  component: () => (
    <RoleGate role="driver">
      <DriverDashboard />
    </RoleGate>
  ),
});

function DriverDashboard() {
  return (
    <DashboardShell title="Driver Dashboard" subtitle="Live tracking & green corridor">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <Ambulance className="size-6 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Ambulance</p>
              <p className="font-semibold">AMB001</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Status</p>
          <p className="text-success font-medium">Online · Idle</p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <MapPin className="size-6 text-accent" />
            <p className="font-semibold">Live GPS</p>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Map and route picker will appear here in Phase 2.
          </p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <Activity className="size-6 text-warning" />
            <p className="font-semibold">Corridor</p>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Green corridor status & countdowns will appear here.
          </p>
        </div>
      </div>

      <div className="glass-card mt-6 p-6 text-center text-sm text-muted-foreground">
        Phase 2 will add live map, hospital selection, and corridor engine.
      </div>
    </DashboardShell>
  );
}
