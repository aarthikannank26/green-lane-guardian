import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, Polyline, ambulanceIcon, hospitalIcon, accidentIcon, signalIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { ensureSvceAmbulanceRecord } from "@/lib/svce-seed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Ambulance, Hospital, AlertTriangle, Play, Square, MapPin, Gauge, Timer } from "lucide-react";
import { haversine, formatDistance, formatEta } from "@/lib/geo";
import { toast } from "sonner";

export const Route = createFileRoute("/driver")({
  head: () => ({ meta: [{ title: "Driver Dashboard" }] }),
  component: () => (
    <RoleGate role="driver">
      <DriverDashboard />
    </RoleGate>
  ),
});

interface Hospital {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}
interface Signal {
  id: string;
  signal_code: string;
  junction_name: string;
  latitude: number;
  longitude: number;
  status: "red" | "yellow" | "green" | "priority_green";
}

interface Accident {
  id: string;
  latitude: number;
  longitude: number;
  description: string | null;
  assigned_hospital_id: string | null;
  status: string;
}

const SIGNAL_TRIGGER_DISTANCE = 600; // meters: start considering signal
const SIGNAL_GREEN_LEAD_SECONDS = 15; // turn green 15s before arrival
const PASSED_DISTANCE = 60; // meters: consider signal passed
const DEFAULT_SPEED_MPS = 12; // ~43 km/h fallback when no speed

function DriverDashboard() {
  const { user } = useAuth();
  const [ambulanceId, setAmbulanceId] = useState("");
  const [pos, setPos] = useState<[number, number]>([12.9716, 77.5946]);
  const [speed, setSpeed] = useState(0);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [search, setSearch] = useState("");
  const [destination, setDestination] = useState<Hospital | null>(null);
  const [assignedAccident, setAssignedAccident] = useState<Accident | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [accidentRoutePath, setAccidentRoutePath] = useState<[number, number][]>([]);
  const [hospitalRoutePath, setHospitalRoutePath] = useState<[number, number][]>([]);
  const [routeStage, setRouteStage] = useState<"to_accident" | "to_hospital" | null>(null);
  const [routeStatus, setRouteStatus] = useState<string>("");
  const [autoMode, setAutoMode] = useState(true);
  const [tripActive, setTripActive] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const simRef = useRef<number | null>(null);
  const routeRef = useRef<[number, number][]>([]);
  const routeIndexRef = useRef(0);
  const longPressRef = useRef<number | null>(null);
  const logoClicks = useRef<{ count: number; t: number }>({ count: 0, t: 0 });

  useEffect(() => {
    void ensureSvceAmbulanceRecord();
  }, []);

  // Load hospitals + signals
  useEffect(() => {
    supabase.from("hospitals").select("*").then(({ data }) => setHospitals((data as Hospital[]) ?? []));
    supabase.from("traffic_signals").select("*").then(({ data }) => setSignals((data as Signal[]) ?? []));
    if (ambulanceId) {
      supabase.from("ambulances").select("current_lat,current_lng,current_speed,status").eq("ambulance_id", ambulanceId).single().then(({ data }) => {
        if (data?.current_lat && data?.current_lng) setPos([data.current_lat, data.current_lng]);
        if (data?.current_speed) setSpeed(data.current_speed);
      });
    }
    const ch = supabase
      .channel("driver-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "traffic_signals" }, (p) => {
        setSignals((curr) => {
          const next = [...curr];
          const i = next.findIndex((s) => s.id === (p.new as Signal)?.id);
          if (p.eventType === "DELETE") return next.filter((s) => s.id !== (p.old as Signal).id);
          if (i >= 0) next[i] = p.new as Signal;
          else if (p.new) next.push(p.new as Signal);
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ambulanceId]);

  useEffect(() => {
    if (!user || ambulanceId) return;
    const emailId = user.email?.split("@")[0];
    if (emailId) setAmbulanceId(emailId.toUpperCase());
  }, [user, ambulanceId]);

  const normalizeRoute = (route: [number, number][]) => {
    const cleaned = route.filter((point, index) => {
      if (index === 0) return true;
      const prev = route[index - 1];
      return point[0] !== prev[0] || point[1] !== prev[1];
    });
    return cleaned.length > 1 ? cleaned : route;
  };

  const fetchRoadRoute = async (from: [number, number], to: [number, number]) => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data || data.code !== "Ok" || !data.routes?.length) throw new Error("Route fetch failed");
      return normalizeRoute((data.routes[0].geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]));
    } catch (error) {
      console.warn("OSRM route failed, falling back to straight line", error);
      return normalizeRoute([from, to]);
    }
  };

  const prepareAssignedRoutes = async (acc: Accident, hosp: Hospital | null, currentPos: [number, number], stage: "to_accident" | "to_hospital") => {
    const accidentRoute = await fetchRoadRoute(currentPos, [acc.latitude, acc.longitude]);
    setAccidentRoutePath(accidentRoute);

    let hospitalRoute: [number, number][] = [];
    if (hosp) {
      hospitalRoute = await fetchRoadRoute([acc.latitude, acc.longitude], [hosp.latitude, hosp.longitude]);
      setHospitalRoutePath(hospitalRoute);
    }

    if (stage === "to_accident") {
      setRoutePath(accidentRoute);
      routeRef.current = accidentRoute;
      routeIndexRef.current = 0;
    } else if (stage === "to_hospital") {
      setRoutePath(hospitalRoute.length ? hospitalRoute : accidentRoute);
      routeRef.current = hospitalRoute.length ? hospitalRoute : accidentRoute;
      routeIndexRef.current = 0;
    }
  };

  const loadAssignedAccident = async (id: string) => {
    const { data, error } = await supabase
      .from("accidents")
      .select("*")
      .in("status", ["assigned", "en_route_to_accident", "en_route_to_hospital"])
      .eq("assigned_ambulance_id", id)
      .single();

    if (error || !data) return;
    const acc = data as Accident;
    let hosp = hospitals.find((h) => h.id === acc.assigned_hospital_id) ?? null;
    if (!hosp && acc.assigned_hospital_id) {
      const { data: hospitalData } = await supabase.from("hospitals").select("*").eq("id", acc.assigned_hospital_id).single();
      hosp = (hospitalData as Hospital) ?? null;
    }

    setAssignedAccident(acc);
    setRouteStatus(acc.status === "en_route_to_hospital" ? "Heading to hospital" : "Heading to accident");
    const stage = acc.status === "en_route_to_hospital" ? "to_hospital" : "to_accident";
    setRouteStage(stage);
    if (hosp) setDestination(hosp);
    if (acc.latitude && acc.longitude) {
      await prepareAssignedRoutes(acc, hosp, pos, stage);
    }
  };


  // ---- Listen for accidents assigned to this ambulance ----
  useEffect(() => {
    if (!ambulanceId) return;
    void loadAssignedAccident(ambulanceId);

    const handle = async (acc: Accident) => {
      let hosp = hospitals.find((h) => h.id === acc.assigned_hospital_id) ?? null;
      if (!hosp && acc.assigned_hospital_id) {
        const { data } = await supabase.from("hospitals").select("*").eq("id", acc.assigned_hospital_id).single();
        hosp = (data as Hospital) ?? null;
      }
      toast.error(`🚨 NEW EMERGENCY ASSIGNED · ${acc.description ?? "Accident"}`, { duration: 8000 });
      setAssignedAccident(acc);
      setRouteStatus("Heading to accident");
      if (hosp) {
        setDestination(hosp);
      }
      setRouteStage("to_accident");
      setAutoMode(true);
      if (acc.latitude && acc.longitude) {
        await prepareAssignedRoutes(acc, hosp, pos, "to_accident");
        setTimeout(() => { void startTripRef.current?.(); }, 3000);
      }
      if (user) {
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "assignment",
          title: `Emergency assigned to ${ambulanceId}`,
          body: `${acc.description ?? "Accident"} — routing to ${hosp?.name ?? "hospital"}`,
        });
      }
      if (acc.id) {
        await supabase.from("accidents").update({ status: "en_route_to_accident" }).eq("id", acc.id);
      }
    };
    const ch = supabase
      .channel(`amb-${ambulanceId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "accidents", filter: `assigned_ambulance_id=eq.${ambulanceId}` },
        (p) => handle(p.new as Accident))
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "accidents", filter: `assigned_ambulance_id=eq.${ambulanceId}` },
        (p) => { if ((p.new as Accident).status === "assigned") handle(p.new as Accident); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ambulanceId, hospitals, pos, user]);

  // Ref so the realtime callback can call startTrip after state is set
  const startTripRef = useRef<(() => void | Promise<unknown>) | null>(null);

  // Filter hospitals (search + nearest)
  const filteredHospitals = useMemo(() => {
    const q = search.toLowerCase();
    return hospitals
      .filter((h) => !q || h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q))
      .map((h) => ({ ...h, _dist: haversine({ lat: pos[0], lng: pos[1] }, { lat: h.latitude, lng: h.longitude }) }))
      .sort((a, b) => a._dist - b._dist);
  }, [hospitals, search, pos]);

  useEffect(() => {
    if (tripActive || assignedAccident || !destination) return;
    const loadHospitalRoute = async () => {
      const route = await fetchRoadRoute(pos, [destination.latitude, destination.longitude]);
      setRoutePath(route);
      routeRef.current = route;
      routeIndexRef.current = 0;
      setRouteStage("to_hospital");
      setRouteStatus("Ready to hospital");
    };
    void loadHospitalRoute();
  }, [destination, pos, assignedAccident, tripActive]);

  // Distance to destination + route line
  const currentRouteTarget = routeStage === "to_accident"
    ? assignedAccident && { lat: assignedAccident.latitude, lng: assignedAccident.longitude }
    : destination
      ? { lat: destination.latitude, lng: destination.longitude }
      : null;

  const routeDistance = routePath.length > 1
    ? routePath.slice(1).reduce((sum, point, index) => {
      const prev = routePath[index];
      return sum + haversine({ lat: prev[0], lng: prev[1] }, { lat: point[0], lng: point[1] });
    }, 0)
    : currentRouteTarget
      ? haversine({ lat: pos[0], lng: pos[1] }, currentRouteTarget)
      : 0;
  const distanceToDest = routeDistance;
  const etaSeconds = routeDistance ? routeDistance / Math.max(speed || DEFAULT_SPEED_MPS, 3) : 0;

  // Signals along current route target (accident or hospital)
  const corridorSignals = useMemo(() => {
    if (!currentRouteTarget) return [];
    return signals
      .map((s) => ({
        ...s,
        distFromAmb: haversine({ lat: pos[0], lng: pos[1] }, { lat: s.latitude, lng: s.longitude }),
        distFromDest: haversine(currentRouteTarget, { lat: s.latitude, lng: s.longitude }),
      }))
      .filter((s) => s.distFromAmb + s.distFromDest < distanceToDest + 800)
      .sort((a, b) => a.distFromAmb - b.distFromAmb);
  }, [signals, currentRouteTarget, pos, distanceToDest]);

  const upcomingSignals = corridorSignals.filter((s) => s.distFromAmb > PASSED_DISTANCE);
  const clearedSignals = corridorSignals.length - upcomingSignals.length;

  // Corridor engine — auto mode
  useEffect(() => {
    if (!autoMode || !tripActive || !currentRouteTarget) return;
    const sp = Math.max(speed || DEFAULT_SPEED_MPS, 3);
    corridorSignals.forEach(async (s) => {
      const etaToSignal = s.distFromAmb / sp;
      const shouldBeGreen =
        s.distFromAmb > PASSED_DISTANCE &&
        s.distFromAmb < SIGNAL_TRIGGER_DISTANCE &&
        etaToSignal <= SIGNAL_GREEN_LEAD_SECONDS;
      if (shouldBeGreen && s.status !== "priority_green") {
        await supabase
          .from("traffic_signals")
          .update({ status: "priority_green", last_activation: new Date().toISOString() })
          .eq("id", s.id);
        setLogs((l) => [`✓ ${s.junction_name} → GREEN (${Math.round(etaToSignal)}s ahead)`, ...l].slice(0, 8));
      } else if (s.distFromAmb < PASSED_DISTANCE && s.status === "priority_green") {
        await supabase.from("traffic_signals").update({ status: "red" }).eq("id", s.id);
        setLogs((l) => [`↺ ${s.junction_name} → restored`, ...l].slice(0, 8));
      }
    });
  }, [autoMode, tripActive, currentRouteTarget, corridorSignals, speed]);

  // ESP32 GPS simulator — when trip active, follows the route path
  const advanceTrip = async () => {
    const route = routeRef.current;
    if (route.length < 2) return;

    const nextIndex = routeIndexRef.current + 1;
    if (nextIndex >= route.length) {
      if (routeStage === "to_accident" && assignedAccident) {
        setLogs((l) => [`🚨 Reached accident location`, ...l].slice(0, 8));
        setRouteStatus("Picking up patient, routing to hospital");
        await supabase.from("accidents").update({ status: "en_route_to_hospital" }).eq("id", assignedAccident.id);
        await supabase.from("ambulances").update({ status: "en_route_to_hospital" }).eq("ambulance_id", ambulanceId);
        if (destination) {
          const newRoute = await fetchRoadRoute([assignedAccident.latitude, assignedAccident.longitude], [destination.latitude, destination.longitude]);
          setRoutePath(newRoute);
          setHospitalRoutePath(newRoute);
          routeRef.current = newRoute;
          routeIndexRef.current = 0;
          setRouteStage("to_hospital");
        }
        return;
      }

      if (routeStage === "to_hospital" && assignedAccident) {
        await supabase.from("accidents").update({ status: "completed" }).eq("id", assignedAccident.id);
        await supabase.from("ambulances").update({ status: "idle", destination_hospital_id: null }).eq("ambulance_id", ambulanceId);
        stopTrip();
        toast.success("Arrived at hospital");
        setRouteStatus("Completed");
        setAssignedAccident(null);
        setRouteStage(null);
        setRoutePath([]);
        return;
      }

      if (routeStage === "to_hospital" && !assignedAccident) {
        await supabase.from("ambulances").update({ status: "idle", destination_hospital_id: null }).eq("ambulance_id", ambulanceId);
        stopTrip();
        toast.success("Arrived at hospital");
        setRouteStatus("Completed");
        setDestination(null);
        setRouteStage(null);
        setRoutePath([]);
        return;
      }

      return;
    }

    const next = route[nextIndex];
    routeIndexRef.current = nextIndex;
    setPos(next);
    setSpeed(14);
    await supabase.from("gps_logs").insert({
      ambulance_id: ambulanceId,
      latitude: next[0],
      longitude: next[1],
      speed: 14,
    });
    await supabase
      .from("ambulances")
      .update({
        current_lat: next[0],
        current_lng: next[1],
        current_speed: 14,
        status: routeStage === "to_accident" ? "en_route_to_accident" : "on_trip",
        last_update: new Date().toISOString(),
      })
      .eq("ambulance_id", ambulanceId);
  };

  const startTrip = async () => {
    let route = routeRef.current.length > 1 ? routeRef.current : routePath;
    if (route.length < 2) {
      if (routeStage === "to_accident" && assignedAccident) {
        route = await fetchRoadRoute(pos, [assignedAccident.latitude, assignedAccident.longitude]);
      } else if (routeStage === "to_hospital" && destination) {
        route = await fetchRoadRoute(pos, [destination.latitude, destination.longitude]);
      }
      if (route.length > 1) {
        setRoutePath(route);
        routeRef.current = route;
      }
    }

    if (route.length < 2) {
      return toast.error("Route unavailable");
    }

    routeRef.current = route;
    routeIndexRef.current = 0;
    setPos(route[0]);
    setTripActive(true);
    setLogs((l) => [`▶ Trip started ${routeStage === "to_accident" ? "→ accident" : "→ hospital"}`, ...l]);
    await supabase.from("emergency_corridors").insert({
      ambulance_id: ambulanceId,
      destination_hospital_id: destination?.id ?? null,
      mode: manualOverride ? "manual" : "automatic",
      created_by: user?.id,
    });

    if (simRef.current) window.clearInterval(simRef.current);
    await advanceTrip();
    simRef.current = window.setInterval(advanceTrip, 1500);
  };

  const stopTrip = () => {
    if (simRef.current) window.clearInterval(simRef.current);
    simRef.current = null;
    setTripActive(false);
    setSpeed(0);
    setManualOverride(false);
    setLogs((l) => [`■ Trip ended`, ...l]);
  };

  useEffect(() => () => { if (simRef.current) window.clearInterval(simRef.current); }, []);

  // Keep ref pointing at latest startTrip so realtime callback can invoke it
  useEffect(() => { startTripRef.current = startTrip; });

  // ---- 15-second signal cycle along the corridor while trip is active ----
  // Every 15s, advance one signal: previous goes back to red, next becomes priority_green.
  useEffect(() => {
    if (!tripActive || !destination || corridorSignals.length === 0) return;
    let idx = 0;
    const tick = async () => {
      const upcoming = corridorSignals.filter((s) => s.distFromAmb > PASSED_DISTANCE);
      if (upcoming.length === 0) return;
      const current = upcoming[idx % upcoming.length];
      const prev = upcoming[(idx - 1 + upcoming.length) % upcoming.length];
      if (prev && prev.id !== current.id) {
        await supabase.from("traffic_signals").update({ status: "red" }).eq("id", prev.id);
      }
      await supabase.from("traffic_signals")
        .update({ status: "priority_green", last_activation: new Date().toISOString() })
        .eq("id", current.id);
      setLogs((l) => [`⏱ 15s cycle → ${current.junction_name} GREEN`, ...l].slice(0, 8));
      idx += 1;
    };
    tick();
    const t = window.setInterval(tick, 15000);
    return () => window.clearInterval(t);
  }, [tripActive, destination, corridorSignals]);

  // Hidden manual override — long press OR triple click on logo
  const startLongPress = () => {
    longPressRef.current = window.setTimeout(() => activateManualOverride("long_press"), 5000);
  };
  const cancelLongPress = () => {
    if (longPressRef.current) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
  };
  const handleLogoClick = () => {
    const now = Date.now();
    const { count, t } = logoClicks.current;
    if (now - t < 600) {
      logoClicks.current = { count: count + 1, t: now };
      if (count + 1 >= 3) {
        activateManualOverride("triple_click");
        logoClicks.current = { count: 0, t: 0 };
      }
    } else {
      logoClicks.current = { count: 1, t: now };
    }
  };
  const activateManualOverride = async (method: string) => {
    setManualOverride(true);
    setAutoMode(false);
    toast.error("MANUAL EMERGENCY CORRIDOR MODE ACTIVATED", { duration: 5000 });
    await supabase.from("manual_override_logs").insert({
      activated_by: user?.id,
      ambulance_id: ambulanceId,
      remarks: `Activated via ${method}`,
    });
  };

  return (
    <div className={manualOverride ? "emergency-border" : ""} onClick={handleLogoClick}>
      <DashboardShell title="Driver Dashboard" subtitle={manualOverride ? "⚠ MANUAL OVERRIDE ACTIVE" : "Live tracking & green corridor"}>
        {manualOverride && (
          <div className="mb-4 flex items-center justify-between rounded-xl border-2 border-destructive bg-destructive/10 p-3 text-sm">
            <span className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" /> MANUAL OVERRIDE ACTIVE — All route signals are priority. Admin notified.
            </span>
            <span className="text-xs text-muted-foreground">{new Date().toLocaleTimeString()}</span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Map */}
          <div className="glass-card overflow-hidden p-0">
            <CityMap center={pos} zoom={14} recenter className="h-115 w-full">
              <Marker position={pos} icon={ambulanceIcon} />
              {assignedAccident && (
                <Marker position={[assignedAccident.latitude, assignedAccident.longitude]} icon={accidentIcon} />
              )}
              {destination && <Marker position={[destination.latitude, destination.longitude]} icon={hospitalIcon} />}
              {accidentRoutePath.length > 1 && assignedAccident && (
                <Polyline positions={accidentRoutePath} pathOptions={{ color: "oklch(0.55 0.24 25)", weight: 4, dashArray: "8 8" }} />
              )}
              {hospitalRoutePath.length > 1 && assignedAccident && (
                <Polyline positions={hospitalRoutePath} pathOptions={{ color: "oklch(0.62 0.18 150)", weight: 4, dashArray: "4 10" }} />
              )}
              {!assignedAccident && routePath.length > 0 && (
                <Polyline positions={routePath} pathOptions={{ color: "oklch(0.58 0.22 27)", weight: 4, dashArray: "8 8" }} />
              )}
              {signals.map((s) => (
                <Marker key={s.id} position={[s.latitude, s.longitude]} icon={signalIcon(s.status)} />
              ))}
            </CityMap>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Ambulance className="size-5" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Ambulance</Label>
                  <Input
                    value={ambulanceId}
                    onChange={(e) => setAmbulanceId(e.target.value)}
                    className="h-7 w-32 border-0 bg-transparent p-0 text-base font-semibold focus-visible:ring-0"
                  />
                </div>
                <Badge variant={tripActive ? "default" : "secondary"} className="ml-auto">
                  {tripActive ? "On Trip" : "Idle"}
                </Badge>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-muted p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Auto Mode</p>
                  <p className="text-sm font-medium">{autoMode ? "Predictive corridor ON" : "Manual"}</p>
                </div>
                <Switch checked={autoMode} onCheckedChange={setAutoMode} disabled={manualOverride} />
              </div>
            </div>

            {assignedAccident && (
              <div className="glass-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Assigned Accident</p>
                    <p className="text-xs text-muted-foreground">{routeStage === "to_accident" ? "Heading to accident" : "Heading to hospital"}</p>
                  </div>
                  <Badge variant="outline">{routeStatus || assignedAccident.status}</Badge>
                </div>
                <p className="text-sm font-medium">{assignedAccident.description || "No description"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{assignedAccident.latitude.toFixed(4)}, {assignedAccident.longitude.toFixed(4)}</p>
              </div>
            )}

            {/* Hospital select */}
            <div className="glass-card p-4">
              <Label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Hospital className="size-4 text-primary" /> Destination Hospital
              </Label>
              <Input placeholder="Search hospitals…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border">
                {filteredHospitals.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">No hospitals. Ask admin to add some.</p>
                )}
                {filteredHospitals.slice(0, 8).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setDestination(h)}
                    className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted ${
                      destination?.id === h.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{h.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{h.address}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDistance(h._dist)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Route info */}
            {destination && (
              <div className="glass-card grid grid-cols-3 gap-2 p-4 text-center">
                <div>
                  <MapPin className="mx-auto size-4 text-muted-foreground" />
                  <p className="mt-1 text-xs text-muted-foreground">Distance</p>
                  <p className="text-sm font-semibold">{formatDistance(distanceToDest)}</p>
                </div>
                <div>
                  <Timer className="mx-auto size-4 text-muted-foreground" />
                  <p className="mt-1 text-xs text-muted-foreground">ETA</p>
                  <p className="text-sm font-semibold">{formatEta(etaSeconds)}</p>
                </div>
                <div>
                  <Gauge className="mx-auto size-4 text-muted-foreground" />
                  <p className="mt-1 text-xs text-muted-foreground">Speed</p>
                  <p className="text-sm font-semibold">{Math.round(speed * 3.6)} km/h</p>
                </div>
              </div>
            )}

            {/* Trip control */}
            <div className="flex gap-2">
              {!tripActive ? (
                <Button className="flex-1" onClick={startTrip} disabled={!destination}>
                  <Play className="size-4" /> Start Trip
                </Button>
              ) : (
                <Button className="flex-1" variant="destructive" onClick={stopTrip}>
                  <Square className="size-4" /> End Trip
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                title="Hold 5s for emergency override"
                onMouseDown={startLongPress}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={startLongPress}
                onTouchEnd={cancelLongPress}
              >
                <AlertTriangle className="size-4 text-destructive" />
              </Button>
            </div>
          </div>
        </div>

        {/* Corridor status */}
        {destination && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="glass-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Green Corridor Status</h3>
                <Badge variant="outline">
                  {clearedSignals}/{corridorSignals.length} cleared
                </Badge>
              </div>
              <div className="space-y-2">
                {upcomingSignals.slice(0, 5).map((s) => {
                  const sp = Math.max(speed || DEFAULT_SPEED_MPS, 3);
                  const eta = s.distFromAmb / sp;
                  const isGreen = s.status === "priority_green" || s.status === "green";
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <span
                        className={`size-3 rounded-full ${isGreen ? "bg-success" : "bg-destructive signal-blink"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.junction_name}</p>
                        <p className="text-xs text-muted-foreground">{formatDistance(s.distFromAmb)} · {formatEta(eta)}</p>
                      </div>
                      <Badge variant={isGreen ? "default" : "secondary"} className="text-xs">
                        {isGreen ? "GREEN" : "RED"}
                      </Badge>
                    </div>
                  );
                })}
                {upcomingSignals.length === 0 && (
                  <p className="text-sm text-muted-foreground">No signals on route.</p>
                )}
              </div>
            </div>

            <div className="glass-card p-4">
              <h3 className="mb-3 font-semibold">Signal Activation Log</h3>
              <ul className="space-y-1.5 text-sm">
                {logs.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
                {logs.map((l, i) => (
                  <li key={i} className="rounded bg-muted px-2 py-1 font-mono text-xs">{l}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DashboardShell>
    </div>
  );
}
