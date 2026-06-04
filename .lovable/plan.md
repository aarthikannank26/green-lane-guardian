# Smart Emergency Corridor – Build Plan

This is a large final-year project. I'll deliver it in clear phases so you can review at each step. I'll wire it to **your external Supabase project** (uteyqzokzrcjfjhkelgs) — not Lovable Cloud — using the anon key in the client and the SQL schema below run in your Supabase SQL editor.

## Phase 1 — Foundation (this turn)
1. Configure Supabase client (`src/integrations/supabase/client.ts`) using your URL + anon key.
2. Smart City design system in `src/styles.css` (dark mode, blue/green/white, glassmorphism, animated signal tokens).
3. Provide complete **SQL migration script** for you to run in Supabase (tables, RLS, roles, triggers, realtime).
4. Auth pages: Driver / Admin / Hospital login + signup with role-based routing.
5. Route shell: `/`, `/auth`, `/driver`, `/admin`, `/hospital` with role guards.

## Phase 2 — Driver dashboard
- Driver info card, mode toggle (Auto/Manual)
- Live GPS map (Leaflet + OpenStreetMap — free, no API key)
- Hospital search & selection, route line, ETA, distance
- Green corridor status panel, signal countdowns
- Hidden manual override (5s long-press + triple logo click) with red border + alert

## Phase 3 — Admin control center
- KPI overview, live city map with ambulances/hospitals/signals
- Ambulance monitoring table, signal monitoring, manual-override alerts
- Hospital CRUD with map-picker
- Traffic signal CRUD

## Phase 4 — Hospital dashboard
- List of ambulances assigned to / heading to the hospital
- Live locations on map, ETAs, status

## Phase 5 — ESP32 ingestion + realtime
- `POST /api/public/gps/update` server route (TanStack Start) — writes to `gps_logs` and updates ambulance position
- Supabase Realtime subscriptions on `gps_logs`, `traffic_signals`, `emergency_corridors`, `manual_override_logs`
- Corridor engine: when ambulance is within threshold of a signal on route, flip signal GREEN 15s before ETA, restore after pass

## Phase 6 — Extras
- Route replay, notification center, activity logs, CSV report download, analytics placeholder, AI prediction stub

## Technical notes
- **Maps:** Leaflet + OpenStreetMap (no API key). Google Maps would need a billing-enabled key from you.
- **Realtime:** Supabase Realtime channels on the tables above.
- **ESP32 endpoint:** public route under `/api/public/gps/update`, validated with Zod, writes via service role. The service role key must be added as a secret — I'll prompt for it when we wire Phase 5.
- **Auth:** Supabase Auth + `user_roles` table with `app_role` enum (`driver`, `admin`, `hospital`) + `has_role()` security-definer function.

## Database SQL (run this in Supabase → SQL Editor)

```sql
-- ============ ENUMS ============
create type public.app_role as enum ('driver','admin','hospital');
create type public.ambulance_status as enum ('idle','on_trip','returning','offline');
create type public.signal_status as enum ('red','yellow','green','priority_green');
create type public.corridor_mode as enum ('automatic','manual');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  hospital_id uuid,
  created_at timestamptz default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read"  on public.profiles for select to authenticated using (auth.uid() = id);
create policy "own profile write" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- ============ ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "read own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "admin manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ HOSPITALS ============
create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  contact text,
  hospital_type text,
  available_beds int default 0,
  ambulance_count int default 0,
  created_at timestamptz default now()
);
grant select on public.hospitals to anon, authenticated;
grant insert, update, delete on public.hospitals to authenticated;
grant all on public.hospitals to service_role;
alter table public.hospitals enable row level security;
create policy "public read hospitals" on public.hospitals for select using (true);
create policy "admin manage hospitals" on public.hospitals for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ AMBULANCES ============
create table public.ambulances (
  id uuid primary key default gen_random_uuid(),
  ambulance_id text unique not null,
  driver_name text,
  driver_user_id uuid references auth.users(id) on delete set null,
  hospital_id uuid references public.hospitals(id) on delete set null,
  status ambulance_status default 'idle',
  current_lat double precision,
  current_lng double precision,
  current_speed double precision default 0,
  destination_hospital_id uuid references public.hospitals(id),
  last_update timestamptz,
  created_at timestamptz default now()
);
grant select on public.ambulances to authenticated;
grant insert, update, delete on public.ambulances to authenticated;
grant all on public.ambulances to service_role;
alter table public.ambulances enable row level security;
create policy "auth read ambulances" on public.ambulances for select to authenticated using (true);
create policy "driver update own"    on public.ambulances for update to authenticated using (driver_user_id = auth.uid());
create policy "admin manage ambulances" on public.ambulances for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ TRAFFIC SIGNALS ============
create table public.traffic_signals (
  id uuid primary key default gen_random_uuid(),
  signal_code text unique not null,
  junction_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  default_cycle_seconds int default 60,
  status signal_status default 'red',
  last_activation timestamptz,
  next_activation timestamptz,
  created_at timestamptz default now()
);
grant select on public.traffic_signals to anon, authenticated;
grant insert, update, delete on public.traffic_signals to authenticated;
grant all on public.traffic_signals to service_role;
alter table public.traffic_signals enable row level security;
create policy "public read signals" on public.traffic_signals for select using (true);
create policy "admin manage signals" on public.traffic_signals for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ============ GPS LOGS ============
create table public.gps_logs (
  id bigserial primary key,
  ambulance_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  speed double precision,
  recorded_at timestamptz default now()
);
create index gps_logs_amb_time_idx on public.gps_logs (ambulance_id, recorded_at desc);
grant select on public.gps_logs to authenticated;
grant insert on public.gps_logs to anon, authenticated;
grant all on public.gps_logs to service_role;
alter table public.gps_logs enable row level security;
create policy "auth read gps" on public.gps_logs for select to authenticated using (true);
create policy "device insert gps" on public.gps_logs for insert with check (true);

-- ============ EMERGENCY CORRIDORS ============
create table public.emergency_corridors (
  id uuid primary key default gen_random_uuid(),
  ambulance_id text not null,
  destination_hospital_id uuid references public.hospitals(id),
  mode corridor_mode not null default 'automatic',
  status text default 'active',
  signal_ids uuid[] default '{}',
  start_time timestamptz default now(),
  end_time timestamptz,
  created_by uuid references auth.users(id)
);
grant select, insert, update on public.emergency_corridors to authenticated;
grant all on public.emergency_corridors to service_role;
alter table public.emergency_corridors enable row level security;
create policy "auth read corridors" on public.emergency_corridors for select to authenticated using (true);
create policy "auth create corridors" on public.emergency_corridors for insert to authenticated with check (auth.uid() = created_by);
create policy "owner/admin update corridor" on public.emergency_corridors for update to authenticated
  using (created_by = auth.uid() or public.has_role(auth.uid(),'admin'));

-- ============ MANUAL OVERRIDE LOGS ============
create table public.manual_override_logs (
  id uuid primary key default gen_random_uuid(),
  activated_by uuid references auth.users(id),
  ambulance_id text,
  remarks text,
  activated_at timestamptz default now()
);
grant select, insert on public.manual_override_logs to authenticated;
grant all on public.manual_override_logs to service_role;
alter table public.manual_override_logs enable row level security;
create policy "auth read overrides" on public.manual_override_logs for select to authenticated using (true);
create policy "auth insert overrides" on public.manual_override_logs for insert to authenticated with check (activated_by = auth.uid());

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read boolean default false,
  created_at timestamptz default now()
);
grant select, insert, update on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy "own notifs" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own notif update" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "insert notif" on public.notifications for insert to authenticated with check (true);

-- ============ PROFILE AUTO-CREATE ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), new.email);
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ============ REALTIME ============
alter publication supabase_realtime add table
  public.ambulances, public.traffic_signals, public.gps_logs,
  public.emergency_corridors, public.manual_override_logs, public.notifications;
```

After running, create an admin user: sign up via the app, then in SQL editor:
```sql
insert into public.user_roles (user_id, role)
values ('<paste user uuid from auth.users>', 'admin');
```

## What I need to confirm before I start
1. **Maps**: OK to use **Leaflet + OpenStreetMap** (free, no key)? Or do you want Google Maps (you'd provide an API key)?
2. **Scope of first turn**: I'll deliver Phase 1 (Supabase wired, design system, auth + 3 role portals, route shells) so you can run the SQL and log in. Then iterate Phase 2+ in following turns. OK?

Reply "go" (or with answers) and I'll start Phase 1.