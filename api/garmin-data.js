// Server-side proxy: forwards Coach Claude requests to the garmin-mcp
// Vercel function, attaching the bearer token here so it never reaches the
// browser. Same pattern as /api/proxy uses for Anthropic.
//
// Two flavours, switched by the `kind` query param:
//   GET /api/garmin-data?date=YYYY-MM-DD
//     → forwards to garmin-mcp /api/data/morning-brief
//     → returns sleep / body battery / HRV / training readiness / training
//       status / daily summary. Used by the dashboard wake-up call.
//
//   GET /api/garmin-data?date=YYYY-MM-DD&kind=activities
//     → forwards to garmin-mcp /api/data/activities
//     → returns the activities Garmin recorded for that calendar date
//       (HR, pace, distance, training effect). Used by the post-session
//       coach review for cardio days.
//
// Why this is one function not two: Vercel has been refusing to route
// newly-added api/*.js files on this project (404s despite being shown as
// registered in the deployment Output). Extending the working file
// sidesteps that bug entirely.

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const baseUrl = process.env.GARMIN_MCP_URL;
  const token = process.env.GARMIN_MCP_TOKEN;
  if (!baseUrl || !token) {
    return new Response(
      JSON.stringify({
        error:
          "Server not configured: set GARMIN_MCP_URL and GARMIN_MCP_TOKEN env vars on Vercel.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Pull the date param off the incoming URL and forward to garmin-mcp.
  const incoming = new URL(req.url);
  const date = incoming.searchParams.get("date");
  const kind = incoming.searchParams.get("kind") || "morning-brief";
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed ?date=YYYY-MM-DD" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Map the kind to the upstream endpoint. Anything we don't recognise
  // falls back to morning-brief so legacy callers keep working.
  const upstreamPath =
    kind === "activities" ? "/api/data/activities" : "/api/data/morning-brief";
  const target = new URL(`${baseUrl.replace(/\/$/, "")}${upstreamPath}`);
  target.searchParams.set("date", date);

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
