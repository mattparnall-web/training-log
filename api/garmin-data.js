// Server-side proxy: forwards Coach Claude dashboard requests to the
// garmin-mcp Vercel function, attaching the bearer token here so it never
// reaches the browser. Same pattern as /api/proxy uses for Anthropic.

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
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed ?date=YYYY-MM-DD" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const target = new URL(`${baseUrl.replace(/\/$/, "")}/api/data/morning-brief`);
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
