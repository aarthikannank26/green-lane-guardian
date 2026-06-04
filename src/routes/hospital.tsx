import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMapEvents } from "react-leaflet";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, Circle, ambulanceIcon, hospitalIcon, accidentIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Ambulance, AlertTriangle, MapPin } from "lucide-react";
import { haversine, formatDistance, formatEta } from "@/lib/geo";
import { toast } from "sonner";

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
interface Accident { id: string; latitude: number; longitude: number; description: string | null; status: string; assigned_ambulance_id: string | null; assigned_hospital_id: string | null; created_at: string }

const RADIUS_M = 2000; // 2 km search radius

function HospitalDashboard() {
  const { user } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ambulances, setAmbulances] = useState<AmbRow[]>([]);
  const [accidents, setAccidents] = useState<Accident[]>([]);

  const loadAll = async () => {
    const [h, a, ac] = await Promise.all([
      supabase.from("hospitals").select("id,name,latitude,longitude"),
      supabase.from("ambulances").select("*"),
      supabase.from("accidents").select("*").in("status", ["pending", "assigned"]).order("created_at", { ascending: false }),
    ]);
    setHospitals((h.data as Hospital[]) ?? []);
    setAmbulances((a.data as AmbRow[]) ?? []);
    setAccidents((ac.data as Accident[]) ?? []);
    if (h.data && h.data.length && !selectedId) setSelectedId(h.data[0].id);
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel("hosp-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "ambulances" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "accidents" }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
     
  }, []);

  const selected = hospitals.find((h) => h.id === selectedId);
  const incoming = ambulances.filter((a) =>
    a.destination_hospital_id === selectedId && a.current_lat && a.current_lng
  );

  // ---- Emergency reporting ----
  const [open, setOpen] = useState(false);
  const [pickLat, setPickLat] = useState(12.9716);
  const [pickLng, setPickLng] = useState(77.5946);
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (open && selected) { setPickLat(selected.latitude); setPickLng(selected.longitude); }
  }, [open, selected]);

  const findNearest = (lat: number, lng: number) => {
    const candidates = ambulances
      .filter((a) => a.status === "idle" && a.current_lat && a.current_lng)
      .map((a) => ({ a, dist: haversine({ lat, lng }, { lat: a.current_lat!, lng: a.current_lng! }) }))
      .sort((x, y) => x.dist - y.dist);
    return candidates[0] ?? null;
  };

  const findNearestHospital = (lat: number, lng: number) => {
    return hospitals
      .map((h) => ({ h, dist: haversine({ lat, lng }, { lat: h.latitude, lng: h.longitude }) }))
      .sort((x, y) => x.dist - y.dist)[0]?.h ?? null;
  };

  const reportEmergency = async () => {
    const nearestAmb = findNearest(pickLat, pickLng);
    const nearestHosp = findNearestHospital(pickLat, pickLng) ?? selected;
    if (!nearestAmb || nearestAmb.dist > RADIUS_M) {
      // still create the accident, but unassigned
      const { error } = await supabase.from("accidents").insert({
        latitude: pickLat, longitude: pickLng, description: desc,
        reported_by: user?.id, reported_by_hospital_id: selectedId,
        assigned_hospital_id: nearestHosp?.id ?? null,
        status: "pending",
      });
      if (error) return toast.error(error.message);
      toast.warning("No idle ambulance within 2 km. Emergency logged as pending.");
      setOpen(false); setDesc("");
      return;
    }

    const { data: acc, error } = await supabase.from("accidents").insert({
      latitude: pickLat, longitude: pickLng, description: desc,
      reported_by: user?.id, reported_by_hospital_id: selectedId,
      assigned_ambulance_id: nearestAmb.a.ambulance_id,
      assigned_hospital_id: nearestHosp?.id ?? null,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    }).select().single();
    if (error) return toast.error(error.message);

    // Mark ambulance dispatched + set destination hospital
    await supabase.from("ambulances")
      .update({ status: "dispatched", destination_hospital_id: nearestHosp?.id ?? null })
      .eq("ambulance_id", nearestAmb.a.ambulance_id);

    // Notify ALL users (broadcast notification keyed to ambulance_id in body)
    // The driver dashboard listens to accidents table directly, but we also create
    // a notification row for the reporter so they see it in the bell.
    if (user) {
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "dispatch",
        title: `Ambulance ${nearestAmb.a.ambulance_id} dispatched`,
        body: `Routed to ${nearestHosp?.name ?? "nearest hospital"} · ${formatDistance(nearestAmb.dist)} away from accident`,
      });
    }

    toast.success(`Assigned ${nearestAmb.a.ambulance_id} → ${nearestHosp?.name ?? ""}`);
    setOpen(false); setDesc("");
    void acc;
  };

  // Ambulances inside 2km of any pending accident → for highlighting
  const ambulancesInRadius = useMemo(() => {
    const ids = new Set<string>();
    accidents.forEach((acc) => {
      ambulances.forEach((a) => {
        if (a.current_lat && a.current_lng) {
          if (haversine({ lat: acc.latitude, lng: acc.longitude }, { lat: a.current_lat, lng: a.current_lng }) <= RADIUS_M) {
            ids.add(a.id);
          }
        }
      });
    });
    return ids;
  }, [accidents, ambulances]);

  return (
    <DashboardShell title="Hospital Dashboard" subtitle="Incoming ambulances & emergency dispatch">
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
        <Badge variant="destructive">{accidents.length} active emergencies</Badge>

        <div className="ml-auto">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <AlertTriangle className="size-4" /> Emergency on this Location
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Report Emergency / Accident</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Road accident near MG Road, 2 injured" />
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-2"><MapPin className="size-4" /> Click map to mark accident location</Label>
                  <p className="text-xs text-muted-foreground">{pickLat.toFixed(4)}, {pickLng.toFixed(4)} · 2 km search radius shown in red</p>
                </div>
                <PickMap
                  center={[pickLat, pickLng]}
                  pos={[pickLat, pickLng]}
                  onPick={(lat, lng) => { setPickLat(lat); setPickLng(lng); }}
                  ambulances={ambulances}
                />
                <Button onClick={reportEmergency} className="w-full">
                  <AlertTriangle className="size-4" /> Dispatch nearest ambulance
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="glass-card overflow-hidden p-0">
          <CityMap center={selected ? [selected.latitude, selected.longitude] : [12.9716, 77.5946]} zoom={12} className="h-[480px] w-full">
            {selected && <Marker position={[selected.latitude, selected.longitude]} icon={hospitalIcon} />}
            {accidents.flatMap((acc) => [
              <Marker key={`m-${acc.id}`} position={[acc.latitude, acc.longitude]} icon={accidentIcon} />,
              <Circle
                key={`c-${acc.id}`}
                center={[acc.latitude, acc.longitude]}
                radius={RADIUS_M}
                pathOptions={{ color: "oklch(0.55 0.24 25)", fillColor: "oklch(0.55 0.24 25)", fillOpacity: 0.12, weight: 1 }}
              />,
            ])}
            {ambulances.filter((a) => a.current_lat && a.current_lng).map((a) => (
              <Marker key={a.id} position={[a.current_lat!, a.current_lng!]} icon={ambulanceIcon} />
            ))}
          </CityMap>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Active Emergencies</h3>
          {accidents.length === 0 && (
            <div className="glass-card p-4 text-center text-xs text-muted-foreground">No active emergencies.</div>
          )}
          {accidents.map((acc) => {
            const amb = ambulances.find((a) => a.ambulance_id === acc.assigned_ambulance_id);
            const hosp = hospitals.find((h) => h.id === acc.assigned_hospital_id);
            return (
              <div key={acc.id} className="glass-card p-3 text-sm">
                <div className="flex items-center justify-between">
                  <Badge variant={acc.status === "assigned" ? "default" : "secondary"}>{acc.status}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(acc.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="mt-2 line-clamp-2">{acc.description || "(no description)"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {acc.latitude.toFixed(3)}, {acc.longitude.toFixed(3)}
                </p>
                {amb && (
                  <p className="mt-1 text-xs">🚑 <span className="font-mono">{amb.ambulance_id}</span> · {amb.driver_name}</p>
                )}
                {hosp && <p className="text-xs">🏥 {hosp.name}</p>}
              </div>
            );
          })}

          <h3 className="mt-4 text-sm font-semibold">Incoming Ambulances</h3>
          {incoming.length === 0 && (
            <div className="glass-card p-4 text-center text-xs text-muted-foreground">No incoming ambulances.</div>
          )}
          {incoming.map((a) => {
            const dist = selected ? haversine({ lat: a.current_lat!, lng: a.current_lng! }, { lat: selected.latitude, lng: selected.longitude }) : 0;
            const eta = dist / Math.max(a.current_speed ?? 12, 3);
            return (
              <div key={a.id} className="glass-card p-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Ambulance className="size-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{a.ambulance_id}</p>
                    <p className="text-xs text-muted-foreground">{a.driver_name ?? "Driver"}</p>
                  </div>
                  <Badge variant={a.status === "on_trip" ? "default" : "secondary"}>{a.status}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                  <div><p className="text-muted-foreground">Dist</p><p className="font-semibold">{formatDistance(dist)}</p></div>
                  <div><p className="text-muted-foreground">ETA</p><p className="font-semibold">{formatEta(eta)}</p></div>
                  <div><p className="text-muted-foreground">Speed</p><p className="font-semibold">{Math.round((a.current_speed ?? 0) * 3.6)}</p></div>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{ambulancesInRadius.size} ambulance(s) within 2 km of an active accident.</p>
        </div>
      </div>
    </DashboardShell>
  );
}

function PickMap({
  center, pos, onPick, ambulances,
}: { center: [number, number]; pos: [number, number]; onPick: (lat: number, lng: number) => void; ambulances: AmbRow[] }) {
  function Clicker() {
    useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
    return null;
  }
  return (
    <CityMap center={center} zoom={13} className="h-64 w-full">
      <Clicker />
      <Marker position={pos} icon={accidentIcon} />
      <Circle
        center={pos}
        radius={RADIUS_M}
        pathOptions={{ color: "oklch(0.55 0.24 25)", fillColor: "oklch(0.55 0.24 25)", fillOpacity: 0.15, weight: 1 }}
      />
      {ambulances.filter((a) => a.current_lat && a.current_lng).map((a) => (
        <Marker key={a.id} position={[a.current_lat!, a.current_lng!]} icon={ambulanceIcon} />
      ))}
    </CityMap>
  );
}
