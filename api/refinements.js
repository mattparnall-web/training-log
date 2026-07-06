// /api/refinements — read/write endpoint for the programme_refinements table.
//
// This is the bridge between Claude chat (which does long-form planning /
// injury assessment / programme conversations) and the tracker's own "Plan
// today's session" button. Claude chat POSTs a refinement when we agree on
// something worth persisting; the tracker's coach prompt then reads it into
// every planning call so it stops handing back sessions that ignore the
// current injury / constraint.
//
// Endpoints:
//   GET    /api/refinements                — list active + non-expired,
//                                            newest first. Open (no auth).
//   POST   /api/refinements?token=X        — append a new refinement.
//                                            Body: { note, expires_at?, source? }
//   PATCH  /api/refinements?token=X        — deactivate a refinement.
//                                            Body: { id, active: false }
//
// Auth: POST + PATCH require ?token= matching env var REFINEMENTS_WRITE_TOKEN.
// GET is open, same convention as /api/snapshot — the URL itself is the
// (weak) secret. Fine for personal use.

export const config = { runtime: "edge" };

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

function tokenValid(url) {
  const expected = process.env.REFINEMENTS_WRITE_TOKEN;
  if (!expected) return false;
  const presented = new URL(url).searchParams.get("token");
  return typeof presented === "string" && presented === expected;
}

async function sbFetch(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Supabase ${r.status}: ${body.slice(0, 240)}`);
  }
  return r.status === 204 ? null : r.json();
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ---- GET: list active + non-expired ----
  if (req.method === "GET") {
    try {
      const now = new Date().toISOString();
      // active=true AND (expires_at is null OR expires_at > now)
      const rows = await sbFetch(
        `/programme_refinements?select=*&active=eq.true&or=(expires_at.is.null,expires_at.gt.${encodeURIComponent(now)})&order=created_at.desc`
      );
      return jsonResponse({ count: rows?.length || 0, refinements: rows || [] });
    } catch (err) {
      return jsonResponse({ error: String(err?.message || err) }, 502);
    }
  }

  // ---- POST / PATCH: require token ----
  if (req.method === "POST" || req.method === "PATCH") {
    if (!tokenValid(req.url)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }

    if (req.method === "POST") {
      const note = (body?.note || "").trim();
      if (!note) return jsonResponse({ error: "note is required" }, 400);
      const row = {
        note,
        source: (body?.source || "claude_chat").slice(0, 40),
        expires_at: body?.expires_at || null,
        active: true,
      };
      try {
        const created = await sbFetch("/programme_refinements", {
          method: "POST",
          body: JSON.stringify(row),
        });
        return jsonResponse({ created: created?.[0] || null }, 201);
      } catch (err) {
        return jsonResponse({ error: String(err?.message || err) }, 502);
      }
    }

    // PATCH — currently only supports deactivating.
    // Extend later if we need to edit note / expires_at in place.
    const id = body?.id;
    if (!id) return jsonResponse({ error: "id is required" }, 400);
    const patch = {};
    if (typeof body?.active === "boolean") patch.active = body.active;
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ error: "no fields to patch" }, 400);
    }
    try {
      const updated = await sbFetch(
        `/programme_refinements?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        }
      );
      return jsonResponse({ updated: updated?.[0] || null });
    } catch (err) {
      return jsonResponse({ error: String(err?.message || err) }, 502);
    }
  }

  return new Response("Method not allowed", {
    status: 405,
    headers: corsHeaders(),
  });
}
