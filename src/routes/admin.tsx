import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMapEvents } from "react-leaflet";
import { RoleGate } from "@/components/RoleGate";
import { DashboardShell } from "@/components/DashboardShell";
import { CityMap, Marker, ambulanceIcon, hospitalIcon, signalIcon } from "@/components/CityMap";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Ambulance, Building2, TrafficCone, Activity, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Control Center" }] }),
  component: () => (
    <RoleGate role="admin">
      <AdminDashboard />
    </RoleGate>
  ),
});

interface Hospital { id: string; name: string; address: string; latitude: number; longitude: number; contact: string | null; available_beds: number; hospital_type: string | null }
interface Signal { id: string; signal_code: string; junction_name: string; latitude: number; longitude: number; status: "red" | "yellow" | "green" | "priority_green"; default_cycle_seconds: number }
interface AmbulanceRow { id: string; ambulance_id: string; driver_name: string | null; status: string; current_lat: number | null; current_lng: number | null; current_speed: number | null; last_update: string | null }
interface Override { id: string; activated_by: string | null; ambulance_id: string | null; remarks: string | null; activated_at: string }

function AdminDashboard() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ambulances, setAmbulances] = useState<AmbulanceRow[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [corridorsCount, setCorridorsCount] = useState(0);

  const reload = async () => {
    const [h, s, a, o, c] = await Promise.all([
      supabase.from("hospitals").select("*").order("created_at", { ascending: false }),
      supabase.from("traffic_signals").select("*").order("created_at", { ascending: false }),
      supabase.from("ambulances").select("*"),
      supabase.from("manual_override_logs").select("*").order("activated_at", { ascending: false }).limit(20),
      supabase.from("emergency_corridors").select("id", { count: "exact" }).is("end_time", null),
    ]);
    setHospitals((h.data as Hospital[]) ?? []);
    setSignals((s.data as Signal[]) ?? []);
    setAmbulances((a.data as AmbulanceRow[]) ?? []);
    setOverrides((o.data as Override[]) ?? []);
    setCorridorsCount(c.count ?? 0);
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel("admin-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "ambulances" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "traffic_signals" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "hospitals" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_override_logs" }, (p) => {
        reload();
        toast.error(`⚠ Manual override by ${(p.new as Override).ambulance_id ?? "unknown"}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stats = [
    { icon: Ambulance, label: "Active Ambulances", value: ambulances.filter((a) => a.status === "on_trip").length, color: "text-primary" },
    { icon: Activity, label: "Active Corridors", value: corridorsCount, color: "text-success" },
    { icon: Building2, label: "Hospitals", value: hospitals.length, color: "text-accent-foreground" },
    { icon: TrafficCone, label: "Traffic Signals", value: signals.length, color: "text-warning" },
  ];

  return (
    <DashboardShell title="Admin Control Center" subtitle="City-wide monitoring & management">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <s.icon className={`size-6 ${s.color}`} />
            <p className="mt-3 text-xs text-muted-foreground">{s.label}</p>
            <p className="text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="glass-card overflow-hidden p-0">
          <CityMap center={[12.9716, 77.5946]} zoom={12} className="h-[460px] w-full">
            {hospitals.map((h) => <Marker key={h.id} position={[h.latitude, h.longitude]} icon={hospitalIcon} />)}
            {signals.map((s) => <Marker key={s.id} position={[s.latitude, s.longitude]} icon={signalIcon(s.status)} />)}
            {ambulances.filter((a) => a.current_lat && a.current_lng).map((a) => (
              <Marker key={a.id} position={[a.current_lat!, a.current_lng!]} icon={ambulanceIcon} />
            ))}
          </CityMap>
        </div>
        <div className="glass-card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-destructive" /> Manual Override Alerts
          </h3>
          <ul className="space-y-2">
            {overrides.length === 0 && <li className="text-sm text-muted-foreground">No alerts.</li>}
            {overrides.slice(0, 8).map((o) => (
              <li key={o.id} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">{o.ambulance_id ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{o.remarks}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(o.activated_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Tabs defaultValue="hospitals" className="mt-6">
        <TabsList>
          <TabsTrigger value="hospitals">Hospitals</TabsTrigger>
          <TabsTrigger value="signals">Traffic Signals</TabsTrigger>
          <TabsTrigger value="ambulances">Ambulances</TabsTrigger>
        </TabsList>
        <TabsContent value="hospitals"><HospitalsManager hospitals={hospitals} reload={reload} /></TabsContent>
        <TabsContent value="signals"><SignalsManager signals={signals} reload={reload} /></TabsContent>
        <TabsContent value="ambulances"><AmbulancesView ambulances={ambulances} /></TabsContent>
      </Tabs>
    </DashboardShell>
  );
}

function MapPicker({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  function Clicker() {
    useMapEvents({ click: (e) => onChange([e.latlng.lat, e.latlng.lng]) });
    return null;
  }
  return (
    <CityMap center={value} zoom={13} className="h-64 w-full">
      <Clicker />
      <Marker position={value} icon={hospitalIcon} />
    </CityMap>
  );
}

function HospitalsManager({ hospitals, reload }: { hospitals: Hospital[]; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", contact: "", hospital_type: "General", available_beds: 0, latitude: 12.9716, longitude: 77.5946 });

  const submit = async () => {
    const { error } = await supabase.from("hospitals").insert(form);
    if (error) return toast.error(error.message);
    toast.success("Hospital added");
    setOpen(false);
    setForm({ ...form, name: "", address: "", contact: "" });
    reload();
  };
  const del = async (id: string) => {
    if (!confirm("Delete hospital?")) return;
    const { error } = await supabase.from("hospitals").delete().eq("id", id);
    if (error) return toast.error(error.message);
    reload();
  };

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Hospitals</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Add Hospital</Button></DialogTrigger>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Hospital</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="col-span-2 space-y-1"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="space-y-1"><Label>Contact</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              <div className="space-y-1"><Label>Type</Label><Input value={form.hospital_type} onChange={(e) => setForm({ ...form, hospital_type: e.target.value })} /></div>
              <div className="space-y-1"><Label>Available Beds</Label><Input type="number" value={form.available_beds} onChange={(e) => setForm({ ...form, available_beds: +e.target.value })} /></div>
              <div className="space-y-1"><Label>Lat, Lng</Label><Input readOnly value={`${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)}`} /></div>
              <div className="col-span-2"><Label className="mb-1 block">Click map to set location</Label><MapPicker value={[form.latitude, form.longitude]} onChange={([lat, lng]) => setForm({ ...form, latitude: lat, longitude: lng })} /></div>
            </div>
            <Button onClick={submit} className="mt-2">Save</Button>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Address</TableHead><TableHead>Beds</TableHead><TableHead>Coords</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {hospitals.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-medium">{h.name}</TableCell>
              <TableCell className="text-muted-foreground">{h.address}</TableCell>
              <TableCell>{h.available_beds}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{h.latitude.toFixed(3)}, {h.longitude.toFixed(3)}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => del(h.id)}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {hospitals.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No hospitals yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function SignalsManager({ signals, reload }: { signals: Signal[]; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ signal_code: "", junction_name: "", default_cycle_seconds: 60, latitude: 12.9716, longitude: 77.5946 });

  const submit = async () => {
    const { error } = await supabase.from("traffic_signals").insert({ ...form, status: "red" });
    if (error) return toast.error(error.message);
    toast.success("Signal added");
    setOpen(false);
    setForm({ ...form, signal_code: "", junction_name: "" });
    reload();
  };
  const del = async (id: string) => {
    if (!confirm("Delete signal?")) return;
    await supabase.from("traffic_signals").delete().eq("id", id);
    reload();
  };

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Traffic Signals</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Add Signal</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Add Signal</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Signal Code</Label><Input value={form.signal_code} onChange={(e) => setForm({ ...form, signal_code: e.target.value })} /></div>
              <div className="space-y-1"><Label>Junction Name</Label><Input value={form.junction_name} onChange={(e) => setForm({ ...form, junction_name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Cycle (sec)</Label><Input type="number" value={form.default_cycle_seconds} onChange={(e) => setForm({ ...form, default_cycle_seconds: +e.target.value })} /></div>
              <div className="space-y-1"><Label>Lat, Lng</Label><Input readOnly value={`${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)}`} /></div>
              <div className="col-span-2"><Label className="mb-1 block">Click map to set</Label><MapPicker value={[form.latitude, form.longitude]} onChange={([lat, lng]) => setForm({ ...form, latitude: lat, longitude: lng })} /></div>
            </div>
            <Button onClick={submit} className="mt-2">Save</Button>
          </DialogContent>
        </Dialog>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Junction</TableHead><TableHead>Status</TableHead><TableHead>Coords</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>
          {signals.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.signal_code}</TableCell>
              <TableCell className="font-medium">{s.junction_name}</TableCell>
              <TableCell><Badge variant={s.status.includes("green") ? "default" : "secondary"}>{s.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{s.latitude.toFixed(3)}, {s.longitude.toFixed(3)}</TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => del(s.id)}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
            </TableRow>
          ))}
          {signals.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No signals yet.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function AmbulancesView({ ambulances }: { ambulances: AmbulanceRow[] }) {
  return (
    <div className="glass-card p-4">
      <Table>
        <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Driver</TableHead><TableHead>Status</TableHead><TableHead>Location</TableHead><TableHead>Speed</TableHead><TableHead>Last Update</TableHead></TableRow></TableHeader>
        <TableBody>
          {ambulances.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono">{a.ambulance_id}</TableCell>
              <TableCell>{a.driver_name ?? "—"}</TableCell>
              <TableCell><Badge variant={a.status === "on_trip" ? "default" : "secondary"}>{a.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.current_lat?.toFixed(3) ?? "—"}, {a.current_lng?.toFixed(3) ?? "—"}</TableCell>
              <TableCell>{a.current_speed ? `${Math.round((a.current_speed) * 3.6)} km/h` : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.last_update ? new Date(a.last_update).toLocaleTimeString() : "—"}</TableCell>
            </TableRow>
          ))}
          {ambulances.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No ambulances registered.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
