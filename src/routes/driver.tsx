import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, Polyline, ambulanceIcon, hospitalIcon, signalIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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

const SIGNAL_TRIGGER_DISTANCE = 600; // meters: start considering signal
const SIGNAL_GREEN_LEAD_SECONDS = 15; // turn green 15s before arrival
const PASSED_DISTANCE = 60; // meters: consider signal passed
const DEFAULT_SPEED_MPS = 12; // ~43 km/h fallback when no speed

function DriverDashboard() {
  const { user } = useAuth();
  const [ambulanceId, setAmbulanceId] = useState("AMB001");
  const [pos, setPos] = useState<[number, number]>([12.9716, 77.5946]);
  const [speed, setSpeed] = useState(0);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [search, setSearch] = useState("");
  const [destination, setDestination] = useState<Hospital | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  const [tripActive, setTripActive] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const simRef = useRef<number | null>(null);
  const longPressRef = useRef<number | null>(null);
  const logoClicks = useRef<{ count: number; t: number }>({ count: 0, t: 0 });

  // Load hospitals + signals
  useEffect(() => {
    supabase.from("hospitals").select("*").then(({ data }) => setHospitals((data as Hospital[]) ?? []));
    supabase.from("traffic_signals").select("*").then(({ data }) => setSignals((data as Signal[]) ?? []));
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
  }, []);

  // Filter hospitals (search + nearest)
  const filteredHospitals = useMemo(() => {
    const q = search.toLowerCase();
    return hospitals
      .filter((h) => !q || h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q))
      .map((h) => ({ ...h, _dist: haversine({ lat: pos[0], lng: pos[1] }, { lat: h.latitude, lng: h.longitude }) }))
      .sort((a, b) => a._dist - b._dist);
  }, [hospitals, search, pos]);

  // Distance to destination + route line
  const distanceToDest = destination
    ? haversine({ lat: pos[0], lng: pos[1] }, { lat: destination.latitude, lng: destination.longitude })
    : 0;
  const etaSeconds = destination ? distanceToDest / Math.max(speed || DEFAULT_SPEED_MPS, 3) : 0;

  // Signals along route (within corridor of straight line)
  const corridorSignals = useMemo(() => {
    if (!destination) return [];
    return signals
      .map((s) => ({
        ...s,
        distFromAmb: haversine({ lat: pos[0], lng: pos[1] }, { lat: s.latitude, lng: s.longitude }),
        distFromDest: haversine({ lat: destination.latitude, lng: destination.longitude }, { lat: s.latitude, lng: s.longitude }),
      }))
      .filter((s) => s.distFromAmb + s.distFromDest < distanceToDest + 800) // ~800m corridor
      .sort((a, b) => a.distFromAmb - b.distFromAmb);
  }, [signals, destination, pos, distanceToDest]);

  const upcomingSignals = corridorSignals.filter((s) => s.distFromAmb > PASSED_DISTANCE);
  const clearedSignals = corridorSignals.length - upcomingSignals.length;

  // Corridor engine — auto mode
  useEffect(() => {
    if (!autoMode || !tripActive || !destination) return;
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
  }, [autoMode, tripActive, destination, corridorSignals, speed]);

  // ESP32 GPS simulator — when trip active, moves ambulance toward destination
  const startTrip = async () => {
    if (!destination) return toast.error("Select a destination hospital first");
    setTripActive(true);
    setLogs((l) => [`▶ Trip started → ${destination.name}`, ...l]);
    // Log corridor in DB
    await supabase.from("emergency_corridors").insert({
      ambulance_id: ambulanceId,
      destination_hospital_id: destination.id,
      mode: manualOverride ? "manual" : "automatic",
      created_by: user?.id,
    });
    if (simRef.current) window.clearInterval(simRef.current);
    simRef.current = window.setInterval(() => {
      setPos((curr) => {
        const dx = destination.latitude - curr[0];
        const dy = destination.longitude - curr[1];
        const dist = Math.hypot(dx, dy);
        if (dist < 0.0005) {
          stopTrip();
          toast.success("Arrived at destination");
          return [destination.latitude, destination.longitude];
        }
        const step = 0.0008; // ~80m per tick
        const next: [number, number] = [curr[0] + (dx / dist) * step, curr[1] + (dy / dist) * step];
        // post GPS to DB
        supabase.from("gps_logs").insert({
          ambulance_id: ambulanceId,
          latitude: next[0],
          longitude: next[1],
          speed: 14,
        });
        supabase
          .from("ambulances")
          .update({ current_lat: next[0], current_lng: next[1], current_speed: 14, status: "on_trip", last_update: new Date().toISOString() })
          .eq("ambulance_id", ambulanceId);
        return next;
      });
      setSpeed(14);
    }, 1500);
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
            <CityMap center={pos} zoom={14} recenter className="h-[460px] w-full">
              <Marker position={pos} icon={ambulanceIcon} />
              {destination && (
                <>
                  <Marker position={[destination.latitude, destination.longitude]} icon={hospitalIcon} />
                  <Polyline positions={[pos, [destination.latitude, destination.longitude]]} pathOptions={{ color: "oklch(0.58 0.22 27)", weight: 4, dashArray: "8 8" }} />
                </>
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
