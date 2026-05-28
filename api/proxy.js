// Anthropic proxy — used by the whiteboard scan, food photo / text parse,
// coach planner, coach reviser, and post-session review.
//
// Why Node (not Edge):
//   The Edge runtime on Vercel Hobby caps function wall-clock at ~25s. Opus
//   4.6 generating a structured plan with the full programme context + recent
//   reviews regularly takes longer than that and trips FUNCTION_INVOCATION_TIMEOUT.
//   Node serverless allows us to bump maxDuration up to 60s on Hobby, which is
//   plenty for any single coach call.
//
// Trade-off vs. Edge: slightly higher cold-start (~100-300ms) on the first hit
// after idle, but the request is dominated by the Anthropic call anyway so this
// is invisible to the user. CORS isn't an issue because the app and the proxy
// share an origin.

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    // Vercel Node functions auto-parse JSON bodies when Content-Type is
    // application/json. We re-stringify before forwarding so Anthropic sees
    // an identical payload to what the client sent.
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}
