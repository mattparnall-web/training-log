export const config = { runtime: "edge" };

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

export default async function handler(req) {
  // Test insert a minimal session with cardio_activities
  const testSession = {
    id: 9999999999999,
    date: "2026-04-25",
    day_id: "flexible",
    day_name: "Flexible",
    day_type: "flexible",
    exercises: [],
    complexes: [],
    cardio_activities: [{ name: "Row", type: "cardio_activity", activity: "row", distance: 3000, distanceUnit: "m", timeMins: 14.67, timeStr: "14:40", pace: "2:27 /500m", notes: "" }],
    notes: "debug test",
    rpe: null
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify(testSession)
  });

  const text = await resp.text();
  
  return new Response(JSON.stringify({ 
    status: resp.status, 
    ok: resp.ok,
    response: text 
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
