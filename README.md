# Smart Emergency Corridor Creation Using IoT-Based Traffic Control

A full-stack web application that lets a city dispatch ambulances, automatically
turns traffic signals green in front of them ("green corridor"), and lets
hospitals report accidents from a map and have the nearest ambulance assigned
automatically.

> ESP32 hardware integration is documented but not required to demo the system —
> the driver dashboard ships with a built-in GPS simulator so the whole flow
> works in the browser.

---

## 1. Tech stack

| Layer          | Tech                                                  |
|----------------|-------------------------------------------------------|
| Frontend       | React 19 + TypeScript + Tailwind + shadcn/ui          |
| Router / SSR   | TanStack Start (Vite 7)                               |
| Maps           | Leaflet + react-leaflet (OpenStreetMap tiles)         |
| Backend        | Supabase (Postgres + Auth + Realtime)                 |
| Hardware (opt) | ESP32 posting GPS to `/api/public/gps/update`         |

---

## 2. Roles & dashboards

A single test account (`test@gmail.com` / `123456`) gets **all three roles**.
After login, navigate manually to whichever portal you want:

| Role     | URL          | What you can do                                                     |
|----------|--------------|---------------------------------------------------------------------|
| Admin    | `/admin`     | Add hospitals & traffic signals, watch the live city map, see override alerts, open Reports & Replay |
| Driver   | `/driver`    | Pick destination hospital, start trip, watch GPS simulator move the ambulance, signals turn green in front of you, trigger hidden manual override (5 s long-press on the red triangle, or triple-click the logo) |
| Hospital | `/hospital`  | See incoming ambulances + ETAs, click **"Emergency on this Location"** to drop a pin and auto-dispatch the nearest idle ambulance within 2 km |

---

## 3. One-time setup

### 3.1 Run the schema SQL

Open the Supabase SQL editor and run the original schema file (enums,
`hospitals`, `traffic_signals`, `ambulances`, `emergency_corridors`,
`gps_logs`, `manual_override_logs`, `user_roles`, `notifications`,
`has_role()` function, RLS policies, triggers).

### 3.2 Run the seed SQL

Run `supabase_seed.sql` (shipped alongside this README). It:

1. Creates the new **`accidents`** table + RLS + realtime publication.
2. Inserts 5 hospitals, 12 traffic signals and 5 ambulances around Bangalore.
3. Re-applies the "grant all 3 roles to `test@gmail.com`" snippet (safe to
   re-run).

### 3.3 Disable email confirmation

Supabase → **Authentication → Providers → Email** → turn OFF
"Confirm email", so `test@gmail.com` / `123456` works instantly.

### 3.4 Create the test account

Go to `/auth` in the app → **Sign Up** → `test@gmail.com` / `123456`.
Then re-run the role-assignment block in `supabase_seed.sql` (last query)
so the user gets `admin + driver + hospital`.

You can now sign in.

---

## 4. End-to-end demo flow

### Scenario: hospital reports an emergency, driver gets routed automatically.

1. **Open two browsers** (or one normal + one incognito) signed in as
   `test@gmail.com`. Browser A → `/hospital`, Browser B → `/driver`.

2. On the **driver** tab, set the **Ambulance** input to `AMB001` and leave
   the trip idle. Notice your live position is near MG Road.

3. On the **hospital** tab, click **"Emergency on this Location"** (red
   button, top right). A dialog opens with a small map.

4. **Click anywhere on the map** to drop the accident pin. The red shaded
   circle is the **2 km search radius**. Any ambulance icon inside that
   circle is a candidate.

5. Click **"Dispatch nearest ambulance"**. The system:
   - Finds the nearest **idle** ambulance within 2 km.
   - Finds the nearest hospital.
   - Inserts a row in `accidents` with `status = 'assigned'`.
   - Flips that ambulance to `dispatched` and sets its `destination_hospital_id`.
   - Inserts a `notifications` row for the reporter.

6. **Back on the driver tab** (it was listening over Supabase Realtime):
   - A red toast pops up: **"🚨 NEW EMERGENCY ASSIGNED"**.
   - The ambulance jumps to the accident location, destination is set to
     the assigned hospital, and the trip auto-starts after ~1 s.
   - The notification bell in the header gets a badge.

7. As the ambulance moves toward the hospital:
   - The **proximity engine** turns each signal `priority_green` ~15 s
     before the ambulance arrives, then back to `red` after it passes.
   - In addition, a **15-second metronome** sweeps through the signals
     along the corridor — every 15 s the next signal turns green and the
     previous one resets. Watch the "Signal Activation Log" panel and the
     red/green dots on the map.

8. The trip auto-ends on arrival.

### Scenario: manual override

On the driver dashboard, **press and hold the red ⚠ button for 5 seconds**
(or triple-click the small Lovable logo in the header). This:

- Activates `MANUAL EMERGENCY CORRIDOR MODE` (full-screen red border).
- Inserts a row in `manual_override_logs`.
- The admin dashboard receives a realtime toast and a row appears in the
  "Manual Override Alerts" sidebar.

### Scenario: reports & replay

From `/admin`, click **"Reports & Replay"** (top right). You can:

- Browse the trip history table (start/end times, modes, duration).
- Browse the manual override log.
- Pick an `ambulance_id` and a date, then **scrub** the playback slider to
  replay the historical GPS trace on the map, with live distance/speed.
- **Export CSV** for both tables.

---

## 5. Data model (quick reference)

| Table                    | Purpose                                                |
|--------------------------|--------------------------------------------------------|
| `user_roles`             | One user ↔ many roles (`admin / driver / hospital`)    |
| `hospitals`              | Hospital catalogue with lat/lng                        |
| `traffic_signals`        | Junction signals with status + cycle config            |
| `ambulances`             | Vehicle registry + live `current_lat/lng/speed/status` |
| `emergency_corridors`    | Trip records (start, end, mode, hospital)              |
| `gps_logs`               | Every GPS ping (drives Reports → Replay)               |
| `manual_override_logs`   | Hidden manual override audit trail                     |
| `notifications`          | In-app bell notifications per user                     |
| **`accidents`** *(new)*  | Hospital-reported emergencies with assignment fields   |

---

## 6. ESP32 integration (for later)

When you switch from the in-browser simulator to a real device, point your
ESP32 to:

```
POST  https://<your-app>.lovable.app/api/public/gps/update
Content-Type: application/json

{
  "ambulance_id": "AMB001",
  "latitude":  12.9716,
  "longitude": 77.5946,
  "speed":     14.2
}
```

The endpoint updates `ambulances` and appends to `gps_logs`. The dashboards
re-render automatically via Supabase Realtime — no extra wiring needed.

---

## 7. Troubleshooting

| Symptom                                       | Fix                                                                                 |
|-----------------------------------------------|-------------------------------------------------------------------------------------|
| "Email not confirmed" at login                | Step 3.3 above — disable email confirmation in Supabase.                            |
| `/admin` says "Access denied"                 | Re-run the role-assignment query in `supabase_seed.sql` (Step 3.4).                 |
| Hospital map is empty                         | You haven't run `supabase_seed.sql`, or RLS is blocking — make sure the user is authenticated. |
| Driver doesn't get the emergency toast        | The `ambulance_id` in the driver input must match `assigned_ambulance_id`. Default is `AMB001`. |
| Signals not changing during a trip            | Make sure **Auto Mode** is ON, and there are signals along the straight line between you and the hospital (the seed data places several around MG Road / Hosur Road). |

---

## 8. File layout (high level)

```
src/
  components/
    CityMap.tsx           Leaflet wrapper + custom icons (ambulance, hospital, accident, signal)
    DashboardShell.tsx    Common header with NotificationsBell + sign-out
    NotificationsBell.tsx Realtime bell badge
    RoleGate.tsx          Per-route role guard
  hooks/
    use-auth.tsx          Supabase session + roles
  integrations/supabase/
    client.ts             Browser Supabase client
  lib/
    geo.ts                Haversine + distance/eta formatters
    csv.ts                CSV export helper
  routes/
    index.tsx             Landing page
    auth.tsx              Sign in / Sign up
    admin.tsx             Admin Control Center
    driver.tsx            Driver Dashboard + corridor engine + 15s signal cycle
    hospital.tsx          Hospital Dashboard + Emergency reporting
    reports.tsx           Trip history + GPS replay
    api/public/gps/update.ts  ESP32 endpoint
```
