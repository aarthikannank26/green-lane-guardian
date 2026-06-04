import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://uteyqzokzrcjfjhkelgs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZXlxem9renJjamZqaGtlbGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjAzMjAsImV4cCI6MjA5NjEzNjMyMH0.okmas1yIo64ttq8lk8qZveV1TyLcour7h3FktMvsC0Q";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

export type AppRole = "driver" | "admin" | "hospital";
