import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md p-8 text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <a href="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Go home
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md p-8 text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Smart Emergency Corridor" },
      { name: "description", content: "IoT-based traffic control for ambulance green corridors." },
      { property: "og:title", content: "Smart Emergency Corridor" },
      { name: "twitter:title", content: "Smart Emergency Corridor" },
      { property: "og:description", content: "IoT-based traffic control for ambulance green corridors." },
      { name: "twitter:description", content: "IoT-based traffic control for ambulance green corridors." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/89122f35-0f80-4931-9e24-d6001edf24a9/id-preview-522a13b5--efe000aa-23a3-4833-a77c-07d485f1c398.lovable.app-1780592304509.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/89122f35-0f80-4931-9e24-d6001edf24a9/id-preview-522a13b5--efe000aa-23a3-4833-a77c-07d485f1c398.lovable.app-1780592304509.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
