// Server-side proxy: forwards Coach Claude post-session review requests to
// the strava-mcp's /api/data/recent-activities endpoint, attaching the bearer
// token here so it never reaches the browser. Same pattern as
// /api/garmin-data uses for the morning-brief endpoint.

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const baseUrl = process.env.STRAVA_MCP_URL;
  const token = process.env.STRAVA_MCP_TOKEN;
  if (!baseUrl || !token) {
    return new Response(
      JSON.stringify({
        error:
          "Server not configured: set STRAVA_MCP_URL and STRAVA_MCP_TOKEN env vars on Vercel.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Pull the date params off the incoming URL and forward to strava-mcp.
  const incoming = new URL(req.url);
  const since = incoming.searchParams.get("since");
  const before = incoming.searchParams.get("before");

  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed ?since=YYYY-MM-DD" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const target = new URL(
    `${baseUrl.replace(/\/$/, "")}/api/data/recent-activities`
  );
  target.searchParams.set("since", since);
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    target.searchParams.set("before", before);
  }

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
