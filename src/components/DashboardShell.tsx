import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Radio, LogOut } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { NotificationsBell } from "@/components/NotificationsBell";
import type { ReactNode } from "react";

export function DashboardShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/20">
              <Radio className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{title}</p>
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
            <NotificationsBell />
            <Button size="sm" variant="outline" onClick={signOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
