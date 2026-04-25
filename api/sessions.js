export const config = { runtime: "edge" };

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?select=*&order=date.asc`,
      {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const data = await resp.json();

    // Return all fields including cardio_activities and complexes
    const formatted = data.map(r => ({
      date: r.date,
      day: r.day_name,
      type: r.day_type,
      rpe: r.rpe,
      notes: r.notes,
      exercises: r.exercises,
      cardio_activities: r.cardio_activities,
      complexes: r.complexes,
    }));

    return new Response(JSON.stringify(formatted, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
