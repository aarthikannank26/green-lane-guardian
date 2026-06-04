import { Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import type { AppRole } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export function RoleGate({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { loading, user, roles } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" search={{ role }} />;
  if (!roles.includes(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="glass-card max-w-md p-8 text-center">
          <h2 className="text-xl font-semibold">Access denied</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account does not have the <strong>{role}</strong> role assigned.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
