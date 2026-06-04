import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, Polyline, ambulanceIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Download, Play, Pause, RotateCcw, Activity, AlertTriangle, History } from "lucide-react";
import { downloadCSV } from "@/lib/csv";
import { formatDistance, haversine } from "@/lib/geo";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports & Replay" }] }),
  component: () => (
    <RoleGate role="admin">
      <ReportsPage />
    </RoleGate>
  ),
});

interface Corridor {
  id: string;
  ambulance_id: string;
  destination_hospital_id: string | null;
  mode: string;
  status: string | null;
  start_time: string;
  end_time: string | null;
}
interface Override {
  id: string;
  ambulance_id: string | null;
  remarks: string | null;
  activated_at: string;
  activated_by: string | null;
}
interface GpsPoint {
  id: number;
  ambulance_id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  recorded_at: string;
}

function ReportsPage() {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);

  const reload = async () => {
    const [c, o] = await Promise.all([
      supabase.from("emergency_corridors").select("*").order("start_time", { ascending: false }).limit(200),
      supabase.from("manual_override_logs").select("*").order("activated_at", { ascending: false }).limit(200),
    ]);
    setCorridors((c.data as Corridor[]) ?? []);
    setOverrides((o.data as Override[]) ?? []);
  };
  useEffect(() => { reload(); }, []);

  const stats = [
    { icon: Activity, label: "Total Trips", value: corridors.length },
    { icon: History, label: "Active Now", value: corridors.filter((c) => !c.end_time).length },
    { icon: AlertTriangle, label: "Manual Overrides", value: overrides.length },
  ];

  return (
    <DashboardShell title="Reports & Replay" subtitle="History, analytics & route replay">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/admin"><Button variant="outline" size="sm">← Back to Admin</Button></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <s.icon className="size-6 text-primary" />
            <p className="mt-3 text-xs text-muted-foreground">{s.label}</p>
            <p className="text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="trips" className="mt-6">
        <TabsList>
          <TabsTrigger value="trips">Trip History</TabsTrigger>
          <TabsTrigger value="overrides">Override Log</TabsTrigger>
          <TabsTrigger value="replay">Route Replay</TabsTrigger>
        </TabsList>

        <TabsContent value="trips">
          <div className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Emergency Corridor Trips</h3>
              <Button size="sm" variant="outline" onClick={() => downloadCSV(`trips-${Date.now()}.csv`, corridors)}>
                <Download className="size-4" /> Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ambulance</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corridors.map((c) => {
                  const dur = c.end_time
                    ? Math.round((+new Date(c.end_time) - +new Date(c.start_time)) / 60000)
                    : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.ambulance_id}</TableCell>
                      <TableCell>
                        <Badge variant={c.mode === "manual" ? "destructive" : "default"}>{c.mode}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{new Date(c.start_time).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{c.end_time ? new Date(c.end_time).toLocaleString() : "—"}</TableCell>
                      <TableCell>{dur != null ? `${dur} min` : <Badge variant="secondary">active</Badge>}</TableCell>
                      <TableCell>{c.status ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {corridors.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No trips yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="overrides">
          <div className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Manual Override Log</h3>
              <Button size="sm" variant="outline" onClick={() => downloadCSV(`overrides-${Date.now()}.csv`, overrides)}>
                <Download className="size-4" /> Export CSV
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ambulance</TableHead>
                  <TableHead>Activated At</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono">{o.ambulance_id ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(o.activated_at).toLocaleString()}</TableCell>
                    <TableCell>{o.remarks ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {overrides.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No overrides logged.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="replay">
          <RouteReplay />
        </TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function RouteReplay() {
  const [ids, setIds] = useState<string[]>([]);
  const [ambId, setAmbId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    supabase.from("ambulances").select("ambulance_id").then(({ data }) => {
      const list = (data ?? []).map((r) => (r as { ambulance_id: string }).ambulance_id);
      setIds(list);
      if (list.length && !ambId) setAmbId(list[0]);
    });
  }, []);

  const load = async () => {
    if (!ambId || !date) return;
    const start = new Date(`${date}T00:00:00`).toISOString();
    const end = new Date(`${date}T23:59:59`).toISOString();
    const { data } = await supabase
      .from("gps_logs")
      .select("*")
      .eq("ambulance_id", ambId)
      .gte("recorded_at", start)
      .lte("recorded_at", end)
      .order("recorded_at", { ascending: true })
      .limit(5000);
    setPoints((data as GpsPoint[]) ?? []);
    setIdx(0);
    setPlaying(false);
  };

  useEffect(() => {
    if (!playing) {
      if (timer.current) window.clearInterval(timer.current);
      return;
    }
    timer.current = window.setInterval(() => {
      setIdx((i) => {
        if (i >= points.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 250);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, points.length]);

  const positions = useMemo(
    () => points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [points],
  );
  const traveled = useMemo(() => {
    let m = 0;
    for (let i = 1; i <= idx && i < positions.length; i++) {
      m += haversine(
        { lat: positions[i - 1][0], lng: positions[i - 1][1] },
        { lat: positions[i][0], lng: positions[i][1] },
      );
    }
    return m;
  }, [idx, positions]);

  const current = points[idx];
  const center: [number, number] = current
    ? [current.latitude, current.longitude]
    : positions[0] ?? [12.9716, 77.5946];

  return (
    <div className="glass-card p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <div>
          <Label className="text-xs">Ambulance</Label>
          <Select value={ambId} onValueChange={setAmbId}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {ids.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex items-end">
          <Button onClick={load}>Load Route</Button>
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            disabled={!points.length}
            onClick={() => downloadCSV(`gps-${ambId}-${date}.csv`, points as unknown as Record<string, unknown>[])}
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <CityMap center={center} zoom={14} recenter className="h-[420px] w-full">
          {positions.length > 1 && (
            <>
              <Polyline positions={positions} pathOptions={{ color: "oklch(0.7 0.05 27)", weight: 3, opacity: 0.4 }} />
              <Polyline positions={positions.slice(0, idx + 1)} pathOptions={{ color: "oklch(0.58 0.22 27)", weight: 5 }} />
            </>
          )}
          {current && <Marker position={[current.latitude, current.longitude]} icon={ambulanceIcon} />}
        </CityMap>
      </div>

      {points.length > 0 ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <Button size="icon" variant="outline" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button size="icon" variant="outline" onClick={() => { setIdx(0); setPlaying(false); }}>
              <RotateCcw className="size-4" />
            </Button>
            <Slider
              value={[idx]}
              min={0}
              max={Math.max(0, points.length - 1)}
              step={1}
              onValueChange={([v]) => setIdx(v)}
              className="flex-1"
            />
            <span className="w-20 text-right font-mono text-xs text-muted-foreground">
              {idx + 1}/{points.length}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xs text-muted-foreground">Time</p>
              <p className="font-semibold">{current ? new Date(current.recorded_at).toLocaleTimeString() : "—"}</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xs text-muted-foreground">Distance</p>
              <p className="font-semibold">{formatDistance(traveled)}</p>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <p className="text-xs text-muted-foreground">Speed</p>
              <p className="font-semibold">{current?.speed ? `${Math.round(current.speed * 3.6)} km/h` : "—"}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Select an ambulance and date, then click <strong>Load Route</strong>.
        </p>
      )}
    </div>
  );
}
