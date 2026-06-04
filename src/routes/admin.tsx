import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { Ambulance, Building2, TrafficCone, Activity } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Control Center" }] }),
  component: () => (
    <RoleGate role="admin">
      <AdminDashboard />
    </RoleGate>
  ),
});

const stats = [
  { icon: Ambulance, label: "Active Ambulances", value: "0", color: "text-primary" },
  { icon: Activity, label: "Active Corridors", value: "0", color: "text-success" },
  { icon: Building2, label: "Hospitals", value: "0", color: "text-accent" },
  { icon: TrafficCone, label: "Traffic Signals", value: "0", color: "text-warning" },
];

function AdminDashboard() {
  return (
    <DashboardShell title="Admin Control Center" subtitle="City-wide monitoring">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <s.icon className={`size-6 ${s.color}`} />
            <p className="mt-3 text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="glass-card mt-6 p-6 text-center text-sm text-muted-foreground">
        Phase 3 will add live city map, ambulance/signal monitoring, hospital CRUD, and signal management.
      </div>
    </DashboardShell>
  );
}
