import { supabase } from "@/integrations/supabase/client";

export const SVCE_EMAIL = "svce@gmail.com";
export const SVCE_PASSWORD = "123456";
export const SVCE_NAME = "svce";
export const SVCE_AMBULANCE_ID = "SVCE";
export const SVCE_LOCATION: [number, number] = [12.987822, 79.971648];

export async function ensureSvceAmbulanceRecord() {
  try {
    const { data } = await supabase
      .from("ambulances")
      .select("ambulance_id")
      .eq("ambulance_id", SVCE_AMBULANCE_ID)
      .maybeSingle();
    if (data) return;
    await supabase.from("ambulances").insert({
      ambulance_id: SVCE_AMBULANCE_ID,
      driver_name: SVCE_NAME,
      current_lat: SVCE_LOCATION[0],
      current_lng: SVCE_LOCATION[1],
      current_speed: 0,
      status: "idle",
      destination_hospital_id: null,
    });
  } catch (error) {
    console.warn("SVCE ambulance seed failed", error);
  }
}

export async function ensureSvceHospitalAndSignals() {
  // Disabled: this project now assumes hospital and traffic signal data already exists in the database.
  // Use the admin portal to add or remove hospitals and signals instead of seeding them automatically.
  return;
}
