import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase, type AppRole } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Ambulance, ShieldCheck, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  role: z.enum(["driver", "admin", "hospital"]).catch("driver"),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Smart Emergency Corridor" },
      { name: "description", content: "Sign in as driver, admin, or hospital staff." },
    ],
  }),
  component: AuthPage,
});

const ROLE_META: Record<AppRole, { icon: typeof Ambulance; label: string }> = {
  driver: { icon: Ambulance, label: "Driver" },
  admin: { icon: ShieldCheck, label: "Admin" },
  hospital: { icon: Building2, label: "Hospital" },
};

function AuthPage() {
  const { role } = Route.useSearch() as { role: AppRole };
  const navigate = useNavigate();
  const { user, roles, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (roles.includes("admin")) navigate({ to: "/admin", replace: true });
    else if (roles.includes("driver")) navigate({ to: "/driver", replace: true });
    else if (roles.includes("hospital")) navigate({ to: "/hospital", replace: true });
  }, [loading, user, roles, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });
        if (error) throw error;
        if (data.user) {
          // Try to insert role (will succeed for first user / drivers; admin must approve in DB for production).
          await supabase.from("user_roles").insert({ user_id: data.user.id, role });
        }
        toast.success("Account created. You can now sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const Icon = ROLE_META[role].icon;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary/20 glow-primary">
            <Icon className="size-7 text-primary" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">{ROLE_META[role].label} Portal</h1>
          <p className="text-sm text-muted-foreground">Sign in or create an account</p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-secondary/40 p-1">
          {(Object.keys(ROLE_META) as AppRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => navigate({ to: "/auth", search: { role: r }, replace: true })}
              className={`rounded-md py-1.5 text-xs font-medium capitalize transition ${
                r === role ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <TabsContent value="signup" className="mt-0 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required={mode === "signup"} />
              </div>
            </TabsContent>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </Tabs>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          New accounts get the <strong className="capitalize">{role}</strong> role. Admins must be granted in the database.
        </p>
      </div>
    </main>
  );
}
