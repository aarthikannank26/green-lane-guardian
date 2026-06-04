import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, ambulanceIcon, hospitalIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Building2, Ambulance } from "lucide-react";
import { haversine, formatDistance, formatEta } from "@/lib/geo";

export const Route = createFileRoute("/hospital")({
  head: () => ({ meta: [{ title: "Hospital Dashboard" }] }),
  component: () => (
    <RoleGate role="hospital">
      <HospitalDashboard />
    </RoleGate>
  ),
});

interface Hospital { id: string; name: string; latitude: number; longitude: number }
interface AmbRow { id: string; ambulance_id: string; driver_name: string | null; status: string; current_lat: number | null; current_lng: number | null; current_speed: number | null; destination_hospital_id: string | null }

function HospitalDashboard() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ambulances, setAmbulances] = useState<AmbRow[]>([]);

  useEffect(() => {
    supabase.from("hospitals").select("id,name,latitude,longitude").then(({ data }) => {
      setHospitals((data as Hospital[]) ?? []);
      if (data && data.length && !selectedId) setSelectedId(data[0].id);
    });
    const load = () => supabase.from("ambulances").select("*").then(({ data }) => setAmbulances((data as AmbRow[]) ?? []));
    load();
    const ch = supabase
      .channel("hosp-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "ambulances" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedId]);

  const selected = hospitals.find((h) => h.id === selectedId);
  const incoming = ambulances.filter((a) =>
    a.destination_hospital_id === selectedId && a.current_lat && a.current_lng
  );

  return (
    <DashboardShell title="Hospital Dashboard" subtitle="Incoming ambulances & live ETAs">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Building2 className="size-4 text-primary" />
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
        >
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <Badge variant="outline">{incoming.length} incoming</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="glass-card overflow-hidden p-0">
          <CityMap center={selected ? [selected.latitude, selected.longitude] : [12.9716, 77.5946]} zoom={12} className="h-[480px] w-full">
            {selected && <Marker position={[selected.latitude, selected.longitude]} icon={hospitalIcon} />}
            {incoming.map((a) => (
              <Marker key={a.id} position={[a.current_lat!, a.current_lng!]} icon={ambulanceIcon} />
            ))}
          </CityMap>
        </div>
        <div className="space-y-3">
          {incoming.length === 0 && (
            <div className="glass-card p-6 text-center text-sm text-muted-foreground">
              No incoming ambulances right now.
            </div>
          )}
          {incoming.map((a) => {
            const dist = selected ? haversine({ lat: a.current_lat!, lng: a.current_lng! }, { lat: selected.latitude, lng: selected.longitude }) : 0;
            const eta = dist / Math.max(a.current_speed ?? 12, 3);
            return (
              <div key={a.id} className="glass-card p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Ambulance className="size-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{a.ambulance_id}</p>
                    <p className="text-xs text-muted-foreground">{a.driver_name ?? "Driver"}</p>
                  </div>
                  <Badge variant={a.status === "on_trip" ? "default" : "secondary"}>{a.status}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-xs text-muted-foreground">Distance</p><p className="text-sm font-semibold">{formatDistance(dist)}</p></div>
                  <div><p className="text-xs text-muted-foreground">ETA</p><p className="text-sm font-semibold">{formatEta(eta)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Speed</p><p className="text-sm font-semibold">{Math.round((a.current_speed ?? 0) * 3.6)} km/h</p></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
