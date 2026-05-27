// /api/snapshot — combined read-only data endpoint for Claude chat (or any
// other tool) to pull the full picture of Matt's training-log data in one
// shot. No auth; same convention as /api/sessions.
//
// Query params (all optional):
//   ?since=YYYY-MM-DD  Earliest date to include for time-based tables.
//                      Default: 180 days ago. Settings is not time-bounded.
//   ?include=a,b,c     Comma-separated list of tables to include. Default:
//                      all of them. Valid: settings, sessions, planned_sessions,
//                      session_reviews, food_entries, supps_entries, alcohol_entries.
//
// Response shape:
//   {
//     "fetched_at":  ISO timestamp of this request,
//     "since":       ISO date used as the lower bound,
//     "settings":    { ...singleton settings row }       (if included)
//     "sessions":    [ ...session rows ]                  (if included)
//     "planned_sessions": [...]                           (if included)
//     "session_reviews":  [...]                           (if included)
//     "food_entries":     [...]                           (if included)
//     "supps_entries":    [...]                           (if included)
//     "alcohol_entries":  [...]                           (if included)
//   }
//
// CORS is open so Claude chat / other browser-based tools can fetch this
// without proxying.

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

// All tables this endpoint knows how to fetch. The shape of each entry tells
// us how to query Supabase and what the consumer sees as the JSON key.
//
//   - key:        the JSON property name in the response (kept identical to
//                 the table name for clarity; if you want to rename it for
//                 downstream consumers, do it here)
//   - table:      Supabase table name
//   - dateColumn: column used to filter by `?since=`. null = not bounded by time
//   - select:     PostgREST `select=` clause (* unless we want to trim fields)
//   - order:      PostgREST order clause
//   - singleton:  true means return the single row directly (not as an array);
//                 used for settings (id=1).
//   - extraQS:    extra query string (e.g. `id=eq.1` for settings)
const TABLES = [
  { key: "settings",         table: "settings",         dateColumn: null,          select: "*", order: null,                  singleton: true,  extraQS: "id=eq.1" },
  { key: "sessions",         table: "sessions",         dateColumn: "date",        select: "*", order: "date.asc" },
  { key: "planned_sessions", table: "planned_sessions", dateColumn: "date",        select: "*", order: "date.asc" },
  { key: "session_reviews",  table: "session_reviews",  dateColumn: "date",        select: "*", order: "date.asc" },
  { key: "food_entries",     table: "food_entries",     dateColumn: "consumed_at", select: "*", order: "consumed_at.asc" },
  { key: "supps_entries",    table: "supps_entries",    dateColumn: "consumed_at", select: "*", order: "consumed_at.asc" },
  { key: "alcohol_entries",  table: "alcohol_entries",  dateColumn: "consumed_at", select: "*", order: "consumed_at.asc" },
];

const ALL_KEYS = TABLES.map((t) => t.key);

// ISO yyyy-mm-dd for a date N days ago in UTC. Good enough for a snapshot.
function isoNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async function handler(req) {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const includeParam = url.searchParams.get("include");

  // Validate / default the `since` window. We accept YYYY-MM-DD only; anything
  // weird falls back to the 180-day default rather than 500ing.
  let since;
  if (sinceParam && /^\d{4}-\d{2}-\d{2}$/.test(sinceParam)) {
    since = sinceParam;
  } else {
    since = isoNDaysAgo(180);
  }

  // Pick which tables to include.
  const requested = includeParam
    ? includeParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ALL_KEYS;
  const wantedTables = TABLES.filter((t) => requested.includes(t.key));

  // Fetch every requested table in parallel. Each fetch returns either the
  // table key + payload, or the table key + error (so a single broken table
  // doesn't tank the whole response).
  const results = await Promise.all(
    wantedTables.map(async (t) => {
      try {
        // For singletons (settings) we treat `date` filters as N/A. For other
        // tables we apply the date filter when the table has a date column.
        const qs = new URLSearchParams();
        qs.set("select", t.select || "*");
        if (t.order) qs.set("order", t.order);
        if (t.extraQS) {
          // PostgREST `id=eq.1` style — already-formed key=value pairs.
          for (const part of t.extraQS.split("&")) {
            const [k, v] = part.split("=");
            qs.set(k, v);
          }
        }
        if (t.dateColumn && !t.singleton) {
          // Date columns: convert YYYY-MM-DD to either a date or full ISO
          // depending on what the column expects.
          const lowerBound = t.dateColumn === "date" ? since : `${since}T00:00:00Z`;
          qs.set(t.dateColumn, `gte.${lowerBound}`);
        }
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${t.table}?${qs.toString()}`, {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        });
        if (!r.ok) {
          const body = await r.text();
          return { key: t.key, error: `Supabase ${r.status}: ${body.slice(0, 240)}` };
        }
        const rows = await r.json();
        // For singletons, surface the first row directly (or null if missing).
        return { key: t.key, payload: t.singleton ? (rows?.[0] || null) : rows };
      } catch (err) {
        return { key: t.key, error: String(err?.message || err) };
      }
    })
  );

  // Assemble the response.
  const body = {
    fetched_at: new Date().toISOString(),
    since,
    included: wantedTables.map((t) => t.key),
  };
  for (const r of results) {
    if (r.error) {
      body[r.key] = { error: r.error };
    } else {
      body[r.key] = r.payload;
    }
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      ...corsHeaders(),
    },
  });
}
