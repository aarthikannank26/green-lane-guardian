# Emergency Dispatch Flow with Timer Documentation

## Overview
This document explains the complete flow of the emergency dispatch system with the newly added timer feature.

---

## 1. **Hospital Dashboard - Emergency Button**

### Location
- **File**: `src/routes/hospital.tsx`
- **Button**: "Emergency on this Location" (Top-right corner, red destructive variant)
- **Accessibility**: Only visible to users with `hospital` role

### What it does
Clicking this button opens a dialog where hospital staff can:
1. Report an accident with a description
2. Pin the exact location on a map
3. Set a timer for auto-dispatch (NEW FEATURE)
4. Manually dispatch or wait for timer to auto-dispatch

---

## 2. **Emergency Report Dialog - 4 Main Sections**

### Section A: Description Input
```
Field: Textarea
Placeholder: "e.g. Road accident near MG Road, 2 injured"
Purpose: Hospital staff describes the emergency situation
```

### Section B: Location Selection
```
Field: Interactive Map with Marker
Default Location: Selected hospital coordinates
How to use: Click anywhere on the map to drop an accident pin
Visual Indicator: Red 2km radius circle shows search zone
Display: Latitude and longitude coordinates update in real-time
```

### Section C: Auto-Dispatch Timer (NEW FEATURE) ⏱️
```
Timer Input Field:
  - Min: 5 seconds
  - Max: 300 seconds (5 minutes)
  - Default: 30 seconds
  - Cannot be edited while timer is running (disabled state)

Timer Status Display:
  - "30s remaining" (when running)
  - "seconds" (when idle)

Start/Cancel Button:
  - Text changes: "Start Timer" → "Cancel" (when running)
  - Color changes: default → destructive (when running)
  - Provides visual feedback

Helper Text:
  - "Set a timer to auto-dispatch the ambulance after countdown" (idle)
  - "⏱️ Timer running - will auto-dispatch when countdown finishes" (active)
```

### Section D: Manual Dispatch Button
```
Button: "Dispatch nearest ambulance"
State: DISABLED when timer is active
State: ENABLED when timer is idle
Purpose: Manually trigger dispatch immediately (without waiting for timer)
```

---

## 3. **Complete Emergency Dispatch Flow with Timer**

### Scenario A: Using the Timer Feature

#### Step 1: Open Emergency Dialog
1. Hospital staff clicks "Emergency on this Location" button
2. Dialog opens with all sections
3. Default timer is set to 30 seconds

#### Step 2: Fill Emergency Details
1. Enter accident description (e.g., "Car collision at MG Road Junction")
2. Click on map to mark accident location
3. 2km red radius shows ambulance search zone

#### Step 3: Start Timer
1. Optionally adjust timer value (5-300 seconds)
2. Click "Start Timer" button
3. Timer begins counting down
4. Input field becomes disabled
5. Button changes to "Cancel" (destructive/red)
6. Helper text updates: "⏱️ Timer running - will auto-dispatch when countdown finishes"
7. Manual dispatch button is disabled (grayed out)

#### Step 4A: Timer Completes Successfully
1. Countdown reaches 0 seconds
2. **System automatically calls `reportEmergency()`** function
3. Toast notification appears: "⏰ Timer finished! Auto-dispatching ambulance..."
4. All the dispatch logic executes (see Step 5-7 below)
5. Dialog closes automatically
6. Timer state resets to default (30 seconds)

#### Step 4B: User Cancels Timer (optional)
1. Click "Cancel" button while timer is running
2. Timer stops and resets
3. Button returns to "Start Timer" (default blue)
4. Manual dispatch button re-enables
5. User can adjust timer or manually dispatch

---

### Step 5: Finding Nearest Resources

#### 5A. Find Nearest Idle Ambulance
**Logic**:
```
- Search all ambulances with status = "idle"
- Calculate distance to accident location using Haversine formula
- Sort by distance (nearest first)
- Check if distance ≤ 2km (RADIUS_M = 2000 meters)
```

**If found (within 2km)**:
- Continue to Step 6

**If NOT found (outside 2km)**:
- Accident is created with status = "pending" (unassigned)
- Toast warning: "No idle ambulance within 2 km. Emergency logged as pending."
- Dialog closes
- Flow ends (pending ambulance will be assigned later when one becomes available)

#### 5B. Find Nearest Hospital
**Logic**:
```
- Search all hospitals in database
- Calculate distance to accident location using Haversine formula
- Sort by distance (nearest first)
- Default to currently selected hospital if calculation fails
```

---

### Step 6: Create Accident Record

**Database Insert** into `accidents` table:
```json
{
  "latitude": 12.9525,
  "longitude": 77.6245,
  "description": "Car collision at MG Road Junction",
  "status": "assigned",
  "assigned_ambulance_id": "AMB001",
  "assigned_hospital_id": "HOSP_BANGALORE_001",
  "assigned_at": "2024-06-04T10:30:45Z",
  "reported_by": "user_uuid_hospital_staff",
  "reported_by_hospital_id": "HOSP_BANGALORE_001"
}
```

---

### Step 7: Update Ambulance Status

**Database Update** in `ambulances` table:
```
WHERE ambulance_id = "AMB001"

SET:
  - status = "dispatched"
  - destination_hospital_id = "HOSP_BANGALORE_001"
```

**Result**: Ambulance immediately knows:
- Where to go (destination hospital)
- Why (accident has been assigned)
- Real-time tracking can now begin

---

### Step 8: Create Notification for Hospital Staff

**Database Insert** into `notifications` table:
```json
{
  "user_id": "hospital_staff_uuid",
  "type": "dispatch",
  "title": "Ambulance AMB001 dispatched",
  "body": "Routed to Bangalore Medical Center · 1.2 km away from accident"
}
```

**Toast Notification** (realtime visual feedback):
```
Success message shown in bottom-right corner:
"✓ Assigned AMB001 → Bangalore Medical Center"
```

---

### Step 9: Dialog Closes & State Resets

```javascript
// Automatic cleanup
setOpen(false);           // Close dialog
setDesc("");              // Clear description
setTimerActive(false);     // Stop timer
setTimerSeconds(30);      // Reset to default 30s
```

---

### Step 10: Driver Receives Assignment (Real-time)

The driver dashboard is subscribed to the `accidents` table via Supabase real-time:

```javascript
// In driver.tsx, the channel listens for new accidents
.on("postgres_changes", { event: "INSERT", ... }, handleNewAccident)
```

**What driver sees**:
1. **Toast notification** (red, error variant):
   - "🚨 NEW EMERGENCY ASSIGNED · Car collision at MG Road Junction"
   - Displayed for 8 seconds

2. **Map jumps to accident location**:
   - Ambulance icon moves to the accident coordinates
   - Zoom level adjusts for visibility

3. **Destination automatically sets**:
   - Hospital destination is set
   - Route is calculated

4. **Auto-start trip** (if auto-mode enabled):
   - Trip begins automatically
   - Green-corridor signal management starts
   - 15-second signal cycle begins (next signal gets priority_green every 15s)

---

## 4. **State Management Overview**

### Hospital Dashboard States
```typescript
// Emergency reporting states
const [open, setOpen] = useState(false);           // Dialog open/close
const [pickLat, setPickLat] = useState(12.9716);  // Accident latitude
const [pickLng, setPickLng] = useState(77.5946);  // Accident longitude
const [desc, setDesc] = useState("");              // Description text

// Timer states (NEW)
const [timerActive, setTimerActive] = useState(false);    // Is timer running?
const [timerSeconds, setTimerSeconds] = useState(30);     // Countdown value
```

### Real-time Data States
```typescript
const [hospitals, setHospitals] = useState<Hospital[]>([]);
const [ambulances, setAmbulances] = useState<AmbRow[]>([]);
const [accidents, setAccidents] = useState<Accident[]>([]);
```

---

## 5. **Key Features**

### ✅ Timer Features
- **Adjustable countdown**: 5-300 seconds
- **Start/Cancel control**: Full user control
- **Auto-dispatch**: Triggers when timer reaches 0
- **Disabled input during countdown**: Prevents accidental changes
- **Visual feedback**: Color changes, text updates, helper messages

### ✅ Safety Features
- **Manual dispatch disabled while timer active**: Prevents accidental double-dispatch
- **2km search radius**: Ensures nearest available ambulance
- **Status checks**: Only idle ambulances are assigned
- **Fallback handling**: Creates pending accidents if no ambulance nearby

### ✅ Real-time Features
- **Supabase subscriptions**: Instant updates across all users
- **Database triggers**: Automatic status updates
- **Toast notifications**: Real-time feedback at every step
- **Bell notifications**: Persistent notification record

### ✅ Error Handling
- **Network errors**: Toast error messages
- **No nearby ambulance**: Creates pending accident, shows warning
- **Invalid input**: Numeric validation (5-300 range)

---

## 6. **User Experience Timeline**

```
TIME    ACTION                           SYSTEM STATE
0:00s   Click "Emergency on Location"    Dialog opens, timer = 30s
0:05s   Enter description                Ready for input
0:10s   Click map to set location       Marker placed, radius shown
0:15s   Adjust timer to 20 seconds      Input accepts value
0:20s   Click "Start Timer"             Timer begins countdown, button → red
0:20s   Watch countdown                 20s → 19s → 18s... (visual countdown)
0:35s   Timer reaches 0                 "⏰ Timer finished!" toast appears
0:35s   Auto-dispatch triggers          - Nearest ambulance found
                                        - Accident created
                                        - Ambulance updated
                                        - Notifications sent
                                        - Driver notified (red toast)
0:36s   Dialog closes                   State reset, timer → 30s
0:40s   Driver sees emergency           - Map jumped to accident
                                        - Destination set
                                        - Trip auto-started
```

---

## 7. **Edge Cases Handled**

### Case 1: No Ambulances Available
- Accident saved as "pending"
- Warning toast: "No idle ambulance within 2 km"
- Dialog closes, can retry later

### Case 2: No Hospitals in Database
- Falls back to currently selected hospital
- System still completes dispatch

### Case 3: User Closes Dialog While Timer Running
- Timer stops immediately
- States reset to default
- No dispatch occurs

### Case 4: User Changes Timer Value Mid-Countdown
- Input is DISABLED while timer active
- Value cannot be changed until cancelled

### Case 5: Network Error During Dispatch
- Error toast displayed
- Dialog remains open
- User can retry

---

## 8. **Future Enhancements**

Possible improvements to consider:

1. **Sound alerts** when timer finishes
2. **Vibration alerts** on mobile devices
3. **Persistent timer** (survives dialog close, shows in background)
4. **Multiple accident templates** (preset descriptions)
5. **Pre-configured timer defaults** (user preferences)
6. **SMS/Email confirmation** when timer triggers
7. **Audit log** of timer-based vs manual dispatches
8. **Analytics dashboard** tracking average response times

---

## 9. **Important File Locations**

- **Hospital Dashboard**: `src/routes/hospital.tsx`
- **Driver Dashboard**: `src/routes/driver.tsx`
- **Database Client**: `src/integrations/supabase/client.ts`
- **Geolocation Utils**: `src/lib/geo.ts`
- **UI Components**: `src/components/ui/` (Button, Input, Dialog, etc.)
- **CityMap Component**: `src/components/CityMap.tsx`

---

## 10. **Technical Stack**

```
Frontend:   React, TanStack Router, TypeScript
Styling:    Tailwind CSS
Database:   Supabase (PostgreSQL)
Real-time:  Supabase Realtime Subscriptions
Maps:       Leaflet (via react-leaflet)
UI Library: Radix UI (shadcn/ui wrapper)
Toasts:     Sonner
Icons:      Lucide React
```

---

## Summary

The Emergency Dispatch System with Timer provides:
- ✅ **Fast emergency reporting** with flexible timing
- ✅ **Real-time ambulance tracking** and assignment
- ✅ **Automated dispatch** when timer completes
- ✅ **Hospital-to-driver communication** via real-time subscriptions
- ✅ **Safety nets** for edge cases and errors
- ✅ **User-friendly UI** with clear visual feedback
