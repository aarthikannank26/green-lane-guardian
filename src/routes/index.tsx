import { createFileRoute, Link } from "@tanstack/react-router";
import { Ambulance, ShieldCheck, Building2, Activity, Radio, MapPinned } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Emergency Corridor — IoT Traffic Control" },
      { name: "description", content: "Real-time ambulance tracking and automatic green corridor creation via IoT-enabled traffic signals." },
      { property: "og:title", content: "Smart Emergency Corridor" },
      { property: "og:description", content: "IoT-based traffic control creating green corridors for ambulances in real-time." },
    ],
  }),
  component: Landing,
});

const portals = [
  { role: "driver", icon: Ambulance, title: "Driver Portal", desc: "Live GPS, hospital routing, and emergency corridor controls." },
  { role: "admin", icon: ShieldCheck, title: "Admin Control Center", desc: "Manage ambulances, hospitals, signals and monitor city-wide activity." },
  { role: "hospital", icon: Building2, title: "Hospital Portal", desc: "Track incoming ambulances and live ETAs on the map." },
] as const;

function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-60" style={{ background: "var(--gradient-glow)" }} />

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/20 glow-primary">
            <Radio className="size-5 text-primary" />
          </div>
          <span className="font-semibold tracking-tight">SmartCorridor</span>
        </div>
        <nav className="hidden gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-6 pt-10 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          IoT · Realtime · Smart City
        </div>
        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          Green corridors for ambulances,{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            in real time
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-muted-foreground">
          ESP32-powered GPS streams meet smart traffic signals. Signals turn green 15 seconds before
          ambulance arrival — automatically.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {portals.map((p) => (
            <Link
              key={p.role}
              to="/auth"
              search={{ role: p.role }}
              className="glass-card group p-6 text-left transition hover:-translate-y-1 hover:glow-primary"
            >
              <p.icon className="size-7 text-primary" />
              <h3 className="mt-4 font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
              <span className="mt-4 inline-block text-sm text-primary group-hover:underline">
                Continue →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-7xl gap-4 px-6 pb-20 sm:grid-cols-3">
        {[
          { icon: Activity, title: "Realtime telemetry", body: "Sub-second GPS updates via WebSocket and REST." },
          { icon: MapPinned, title: "Predictive signal control", body: "Distance + speed prediction flips signals 15s ahead." },
          { icon: ShieldCheck, title: "Manual override", body: "Hidden emergency mode for authorized drivers." },
        ].map((f) => (
          <div key={f.title} className="glass-card p-6">
            <f.icon className="size-6 text-accent" />
            <h4 className="mt-3 font-semibold">{f.title}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
