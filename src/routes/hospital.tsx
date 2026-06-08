import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMapEvents } from "react-leaflet";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, Polyline, Circle, ambulanceIcon, hospitalIcon, accidentIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ensureSvceHospitalAndSignals } from "@/lib/svce-seed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Building2, Ambulance, AlertTriangle, MapPin, Timer, User, LogOut } from "lucide-react";
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
    const init = async () => {
      await loadAll();
    };
    void init();

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
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(30); // 30 second default timer

  const [assignOpen, setAssignOpen] = useState(false);
  const [activeAssignAccident, setActiveAssignAccident] = useState<Accident | null>(null);
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState<string | null>(null);
  const [selectedHospitalIdForAssign, setSelectedHospitalIdForAssign] = useState<string | null>(null);

  useEffect(() => {
    if (open && selected) { setPickLat(selected.latitude); setPickLng(selected.longitude); }
  }, [open, selected]);

  // ---- Timer for emergency dispatch ----
  useEffect(() => {
    if (!timerActive || timerSeconds <= 0) return;
    const interval = setInterval(() => {
      setTimerSeconds((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerActive, timerSeconds]);

  // Auto-dispatch when timer reaches 0
  useEffect(() => {
    if (timerActive && timerSeconds === 0) {
      setTimerActive(false);
      toast.info("⏰ Timer finished! Auto-dispatching ambulance...");
      reportEmergency();
    }
  }, [timerActive, timerSeconds]);

  const assignableAmbulances = useMemo(() => {
    if (!activeAssignAccident) return [] as { amp: AmbRow; dist: number }[];
    return ambulances
      .filter((a) => a.current_lat && a.current_lng)
      .map((a) => ({
        amp: a,
        dist: haversine({ lat: activeAssignAccident.latitude, lng: activeAssignAccident.longitude }, { lat: a.current_lat!, lng: a.current_lng! }),
      }))
      .sort((a, b) => a.dist - b.dist);
  }, [ambulances, activeAssignAccident]);

  const hospitalsForAssign = useMemo(() => {
    if (!activeAssignAccident) return [] as { h: Hospital; dist: number }[];
    return hospitals
      .map((h) => ({
        h,
        dist: haversine({ lat: activeAssignAccident.latitude, lng: activeAssignAccident.longitude }, { lat: h.latitude, lng: h.longitude }),
      }))
      .sort((a, b) => a.dist - b.dist);
  }, [hospitals, activeAssignAccident]);

  const openAssignDialog = (acc: Accident) => {
    setActiveAssignAccident(acc);
    setSelectedAmbulanceId(null);
    setSelectedHospitalIdForAssign(null);
    setAssignOpen(true);
  };

  const assignEmergency = async () => {
    if (!activeAssignAccident) return;
    const selectedAmb = ambulances.find((a) => a.ambulance_id === selectedAmbulanceId);
    const selectedHosp = hospitals.find((h) => h.id === selectedHospitalIdForAssign) ?? hospitalsForAssign[0]?.h ?? selected;

    if (!selectedAmb || !selectedHosp) {
      return toast.error("Please select an ambulance and hospital to assign.");
    }

    const { error: accError } = await supabase.from("accidents").update({
      assigned_ambulance_id: selectedAmb.ambulance_id,
      assigned_hospital_id: selectedHosp.id,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    }).eq("id", activeAssignAccident.id);
    if (accError) return toast.error(accError.message);

    const { error: ambError } = await supabase.from("ambulances").update({
      status: "dispatched",
      destination_hospital_id: selectedHosp.id,
    }).eq("ambulance_id", selectedAmb.ambulance_id);
    if (ambError) return toast.error(ambError.message);

    if (user) {
      await supabase.from("notifications").insert({
        user_id: user.id,
        type: "dispatch",
        title: `Ambulance ${selectedAmb.ambulance_id} dispatched`,
        body: `Accident assigned, route to ${selectedHosp.name}`,
      });
    }

    toast.success(`Assigned ${selectedAmb.ambulance_id} → ${selectedHosp.name}`);
    setAssignOpen(false);
    setActiveAssignAccident(null);
    setSelectedAmbulanceId(null);
    setSelectedHospitalIdForAssign(null);
  };

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
      setOpen(false);
      setDesc("");
      setTimerActive(false);
      setTimerSeconds(30);
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
    setOpen(false);
    setDesc("");
    setTimerActive(false);
    setTimerSeconds(30);
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
      {/* User Login Info */}
      <div className="mb-4 flex items-center justify-between rounded-lg bg-accent/50 border border-accent px-4 py-2">
        <div className="flex items-center gap-2">
          <User className="size-4 text-primary" />
          <span className="text-sm font-medium">Logged in as:</span>
          <span className="font-mono text-sm bg-primary/10 px-2 py-1 rounded">{user?.email || "Unknown User"}</span>
        </div>
        <span className="text-xs text-muted-foreground">Role: Hospital</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Building2 className="size-4 text-primary" />
        <select
          aria-label="Select hospital"
          title="Select hospital"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
        >
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <Badge variant="outline">{incoming.length} incoming</Badge>
        <Badge variant="destructive">{accidents.length} active emergencies</Badge>

        <div className="ml-auto">
          <Dialog open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) {
              setTimerActive(false);
              setTimerSeconds(30);
              setDesc("");
            }
          }}>
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
                
                {/* Timer Section */}
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <Label className="flex items-center gap-2 text-primary">
                    <Timer className="size-4" /> Auto-Dispatch Timer
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input 
                      type="number" 
                      min="5" 
                      max="300" 
                      value={timerSeconds} 
                      onChange={(e) => {
                        const val = Math.max(5, Math.min(300, parseInt(e.target.value) || 0));
                        setTimerSeconds(val);
                      }}
                      disabled={timerActive}
                      className="w-20 text-center"
                      placeholder="Seconds"
                    />
                    <span className="text-sm font-semibold text-primary">{timerActive ? `${timerSeconds}s remaining` : 'seconds'}</span>
                    <Button 
                      onClick={() => setTimerActive(!timerActive)}
                      variant={timerActive ? "destructive" : "default"}
                      size="sm"
                      className="ml-auto"
                    >
                      {timerActive ? 'Cancel' : 'Start Timer'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {timerActive ? '⏱️ Timer running - will auto-dispatch when countdown finishes' : 'Set a timer to auto-dispatch the ambulance after countdown'}
                  </p>
                </div>

                <Button onClick={reportEmergency} className="w-full" disabled={timerActive}>
                  <AlertTriangle className="size-4" /> Dispatch nearest ambulance
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Assign Ambulance to Pending Accident</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border border-border/70 bg-muted p-4">
                  <p className="text-sm font-semibold">Accident</p>
                  <p className="text-xs text-muted-foreground">{activeAssignAccident?.description || "(no description)"}</p>
                  <p className="text-xs text-muted-foreground">{activeAssignAccident?.latitude.toFixed(4)}, {activeAssignAccident?.longitude.toFixed(4)}</p>
                </div>

                <div className="space-y-2">
                  <Label>Select ambulance</Label>
                  <div className="grid gap-2">
                    {assignableAmbulances.length === 0 && (
                      <p className="text-xs text-muted-foreground">No ambulances are currently available. Please wait or refresh.</p>
                    )}
                    {assignableAmbulances.map(({ amp, dist }) => (
                      <button
                        key={amp.id}
                        type="button"
                        onClick={() => setSelectedAmbulanceId(amp.ambulance_id)}
                        className={`rounded-lg border p-3 text-left ${selectedAmbulanceId === amp.ambulance_id ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{amp.ambulance_id}</p>
                            <p className="text-xs text-muted-foreground">{amp.driver_name || "Driver"}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDistance(dist)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Select hospital</Label>
                  <div className="grid gap-2">
                    {hospitalsForAssign.map(({ h, dist }) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setSelectedHospitalIdForAssign(h.id)}
                        className={`rounded-lg border p-3 text-left ${selectedHospitalIdForAssign === h.id ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{h.name}</p>
                            <p className="text-xs text-muted-foreground">{h.latitude.toFixed(3)}, {h.longitude.toFixed(3)}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDistance(dist)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <Button onClick={assignEmergency} className="w-full" disabled={!selectedAmbulanceId || !selectedHospitalIdForAssign}>
                  Assign selected ambulance
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="glass-card overflow-hidden p-0">
          <CityMap center={selected ? [selected.latitude, selected.longitude] : [12.9716, 77.5946]} zoom={12} className="h-120 w-full">
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
            {accidents.map((acc) => {
              const amb = ambulances.find((a) => a.ambulance_id === acc.assigned_ambulance_id && a.current_lat && a.current_lng);
              const hosp = hospitals.find((h) => h.id === acc.assigned_hospital_id);
              if (!amb || !hosp) return null;
              return (
                <Polyline
                  key={`route-${acc.id}`}
                  positions={[[amb.current_lat!, amb.current_lng!], [acc.latitude, acc.longitude], [hosp.latitude, hosp.longitude]]}
                  pathOptions={{ color: "oklch(0.05 0.55 60)", weight: 3, dashArray: "6 6" }}
                />
              );
            })}
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
                {acc.status === "pending" && (
                  <Button variant="outline" size="sm" onClick={() => openAssignDialog(acc)}>
                    Assign ambulance
                  </Button>
                )}
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
