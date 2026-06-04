import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const Schema = z.object({
  ambulance_id: z.string().min(1).max(64),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(300).optional(),
  timestamp: z.string().optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SUPABASE_URL = "https://uteyqzokzrcjfjhkelgs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZXlxem9renJjamZqaGtlbGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjAzMjAsImV4cCI6MjA5NjEzNjMyMH0.okmas1yIo64ttq8lk8qZveV1TyLcour7h3FktMvsC0Q";

export const Route = createFileRoute("/api/public/gps/update")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const data = Schema.parse(body);
          const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          await supabase.from("gps_logs").insert({
            ambulance_id: data.ambulance_id,
            latitude: data.latitude,
            longitude: data.longitude,
            speed: data.speed ?? 0,
            recorded_at: data.timestamp ?? new Date().toISOString(),
          });
          await supabase
            .from("ambulances")
            .update({
              current_lat: data.latitude,
              current_lng: data.longitude,
              current_speed: data.speed ?? 0,
              last_update: new Date().toISOString(),
            })
            .eq("ambulance_id", data.ambulance_id);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...cors },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "bad request" }),
            { status: 400, headers: { "Content-Type": "application/json", ...cors } }
          );
        }
      },
    },
  },
});
