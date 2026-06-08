// SessionReviews — Workout tab > REVIEW sub-tab.
//
// Lists logged sessions newest-first. Each row has either:
//   * A "GET COACH FEEDBACK" button (if no review saved yet), which calls
//     Claude with the session detail + programme context + recent reviews,
//     and persists the response to the session_reviews table; or
// * The existing review (summary + full text), with "Regenerate" / "Delete".
//
// Reviews persist in Supabase, so they survive reloads + sessions.

import { useEffect, useState, useCallback } from "react";

const SUPABASE_URL = "https://bbkxvbsutpvtuizonzsn.supabase.co";
const SUPABASE_KEY = "sb_publishable__8dc2jqeQIClVXwpZQCSWA_Y5yaV1ao";

const PROXY_URL = "/api/proxy";
const REVIEW_MODEL = "claude-sonnet-4-6";

async function sb(path, options = {}) {
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
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 1200) {
  const r = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REVIEW_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`Proxy ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const block = json?.content?.find?.((c) => c.type === "text");
  if (!block?.text) throw new Error("Empty Claude response");
  return block.text.trim();
}

// ---- JSON extraction (same helper used in the planner) ----
function tryExtractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch {}
  }
  return null;
}

const REVIEW_SYSTEM_PROMPT = `You are an experienced strength & conditioning coach reviewing a completed session for the athlete.

Your job:
- Be specific. Refer to actual exercises and loads from the session.
- Compare to recent sessions and the original plan (when provided) — note progress, regressions, missed reps.
- Be concise. The athlete will read this on a phone. No filler.
- If the athlete left notes/RPE that flag a problem, address it directly.
- Suggest one or two concrete adjustments for next time (e.g. "Drop bench by 5kg next session; bar speed slowed badly on set 4").

OUTPUT — respond ONLY with a JSON object, no preamble or markdown fences:

{
  "summary": "One short sentence the athlete reads first — the headline takeaway.",
  "what_went_well": "2-4 sentences. Be specific about exercises/loads.",
  "what_to_adjust": "2-4 sentences. What was off and why.",
  "next_session_guidance": "2-3 sentences. Concrete loading/volume tweaks for the next time this day-type comes around."
}`;

// Pull Strava activities for a date window from our server-side proxy.
// Returns null on any error (including missing env vars on the server) so a
// Strava outage never blocks a review.
async function fetchStravaForDate(dateStr) {
  if (!dateStr) return null;
  // Window = the day itself ±1 day. Strava sometimes records an activity
  // crossing midnight or a near-midnight upload races the date boundary,
  // and Garmin/Strava timezone handling isn't perfectly aligned either.
  const since = shiftIsoDate(dateStr, -1);
  const before = shiftIsoDate(dateStr, +1);
  try {
    const r = await fetch(
      `/api/strava-data?since=${encodeURIComponent(since)}&before=${encodeURIComponent(before)}`
    );
    if (!r.ok) return null;
    const json = await r.json();
    if (!json || !Array.isArray(json.activities)) return null;
    return json.activities;
  } catch {
    return null;
  }
}

function shiftIsoDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Format the Strava activities block for the review prompt. We give the
// coach the same kind of detail it would otherwise have to ask the athlete
// for: distance, pace, HR averages, elevation, duration.
function formatStravaActivities(activities, sessionDate) {
  if (!activities || activities.length === 0) return null;
  const lines = activities.map((a) => {
    const bits = [];
    if (a.distance_m) bits.push(`${(a.distance_m / 1000).toFixed(2)} km`);
    if (a.moving_time_s) {
      const mins = Math.round(a.moving_time_s / 60);
      bits.push(`${mins} min moving`);
    }
    if (a.average_speed_mps && a.distance_m) {
      // pace = min/km
      const minPerKm = 1000 / a.average_speed_mps / 60;
      const m = Math.floor(minPerKm);
      const s = Math.round((minPerKm - m) * 60);
      bits.push(`${m}:${String(s).padStart(2, "0")}/km avg pace`);
    }
    if (a.average_heartrate) bits.push(`avg HR ${Math.round(a.average_heartrate)}`);
    if (a.max_heartrate) bits.push(`max HR ${Math.round(a.max_heartrate)}`);
    if (a.total_elevation_gain_m) bits.push(`${Math.round(a.total_elevation_gain_m)} m elevation`);
    if (a.suffer_score) bits.push(`Strava suffer ${a.suffer_score}`);
    const dateLabel = a.start_date_local ? a.start_date_local.slice(0, 10) : "?";
    const sameDay = dateLabel === sessionDate ? "" : ` [${dateLabel}]`;
    return `  - ${a.name || a.sport_type || a.type}${sameDay}: ${bits.join(" · ")}`;
  });
  return lines.join("\n");
}

function buildReviewPrompt({ session, programmeContext, recentSessions, recentReviews, plannedSession, stravaActivities }) {
  const programmeBlock = programmeContext?.trim()
    ? `ATHLETE'S PROGRAMME CONTEXT (long-form — always honour this):
"""
${programmeContext.trim()}
"""

`
    : "";

  const plannedBlock = plannedSession?.plan_text
    ? `ORIGINAL PLANNED SESSION (what you prescribed before training):
${plannedSession.plan_text}

`
    : "";

  // Strava block — only emitted when the strava-data proxy returned something
  // and the session involves cardio. Sits right after the cardio section so
  // the coach can compare what the athlete logged to what the watch recorded.
  const stravaText = formatStravaActivities(stravaActivities, session.date);
  const stravaBlock = stravaText
    ? `Strava data for this date (auto-pulled from athlete's watch — use this for HR / pace / elevation context):
${stravaText}
`
    : "";

  const sessionBlock = `COMPLETED SESSION (logged by the athlete — this is what actually happened):
Date: ${session.date}
Day: ${session.day_name || session.day_id || "?"} (${session.day_type || "?"})
RPE: ${session.rpe ?? "not recorded"}
Athlete notes: ${session.notes?.trim() || "(none)"}

Exercises:
${formatExercises(session.exercises)}

${session.complexes?.length ? `Complexes / AMRAP / EMOM:\n${formatComplexes(session.complexes)}\n` : ""}${session.cardio_activities?.length ? `Cardio:\n${formatCardio(session.cardio_activities)}\n` : ""}${stravaBlock}`;

  const recentBlock = recentSessions?.length
    ? `RECENT SESSIONS (for context — most recent first):
${recentSessions.slice(0, 5).map(summariseSession).join("\n")}

`
    : "";

  const reviewsBlock = recentReviews?.length
    ? `YOUR PREVIOUS REVIEWS (you wrote these — keep coherent with them):
${recentReviews.map((r) => `  - ${r.date} ${r.day_name || ""}: ${r.summary || "(no summary)"}`).join("\n")}

`
    : "";

  return `${programmeBlock}${plannedBlock}${sessionBlock}

${recentBlock}${reviewsBlock}Review this session. JSON output only.`;
}

function formatExercises(exs) {
  if (!Array.isArray(exs) || exs.length === 0) return "  (none logged)";
  return exs.map((ex) => {
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    const setText = sets
      .map((s) => `${s.reps || "?"}×${s.weight ? `${s.weight}kg` : "bw"}`)
      .join(", ");
    // Include per-exercise RPE when the athlete recorded one — it tells the
    // coach how hard a specific lift felt, beyond the session-level RPE.
    const rpeText = ex.rpe ? ` (RPE ${ex.rpe})` : "";
    return `  - ${ex.name}: ${setText || "(no sets)"}${rpeText}`;
  }).join("\n");
}

function formatComplexes(cs) {
  return cs.map((c) => {
    const name = c.name || c.type || "Complex";
    const detail = c.summary || c.detail || c.description || JSON.stringify(c);
    return `  - ${name}: ${detail}`;
  }).join("\n");
}

function formatCardio(cs) {
  // The cardio logger saves entries with these fields:
  //   name, activity, distance, distanceUnit, timeMins, timeStr, pace, notes,
  //   rpe (optional). Older code looked for duration_min which doesn't exist —
  //   that's why the coach was seeing nothing useful.
  return cs.map((c) => {
    const name = c.name || c.activity || "Cardio";
    const parts = [];
    if (c.distance && c.distanceUnit) parts.push(`${c.distance}${c.distanceUnit}`);
    if (c.timeStr || c.timeMins) parts.push(`${c.timeStr || c.timeMins + " min"}`);
    if (c.pace) parts.push(c.pace);
    if (c.rpe) parts.push(`RPE ${c.rpe}`);
    const detail = parts.join(" · ");
    const note = c.notes?.trim() ? ` — ${c.notes.trim()}` : "";
    return `  - ${name}${detail ? `: ${detail}` : ""}${note}`;
  }).join("\n");
}

function summariseSession(s) {
  const exNames = (s.exercises || []).slice(0, 4).map((e) => e.name).filter(Boolean);
  return `  - ${s.date} ${s.day_name || s.day_id || ""}: ${exNames.join(", ")}${(s.exercises || []).length > 4 ? "…" : ""} (RPE ${s.rpe ?? "?"})`;
}

// ---- Design tokens (matches WorkoutTracker) ----
const T = {
  bg: "#f8fafc", surface: "#ffffff", surface2: "#f1f5f9",
  border: "#e2e8f0", border2: "#cbd5e1",
  text: "#0f172a", textSub: "#475569", textMuted: "#94a3b8",
  accent: "#ea580c",
};

function dayColor(dayType) {
  switch (dayType) {
    case "upper_push":  return "#7c3aed";
    case "upper_pull":  return "#0891b2";
    case "recovery":    return "#16a34a";
    case "lower_squat": return "#2563eb";
    case "flexible":    return "#94a3b8";
    case "olympic":     return "#dc2626";
    case "cardio":      return "#16a34a";
    default:            return T.textMuted;
  }
}

function prettyDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// ===========================================================================
//                              MAIN COMPONENT
// ===========================================================================
export default function SessionReviews() {
  const [sessions, setSessions] = useState([]);
  const [reviewsById, setReviewsById] = useState({});     // session_id -> review row
  const [plansByDate, setPlansByDate] = useState({});     // date -> planned_sessions row
  const [programmeContext, setProgrammeContext] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sess, revs, plans, settingsRows] = await Promise.all([
        sb("/sessions?select=*&order=date.desc&limit=60"),
        sb("/session_reviews?select=*&order=date.desc&limit=60"),
        sb("/planned_sessions?select=date,plan_text&order=date.desc&limit=60"),
        sb("/settings?select=programme_context&id=eq.1"),
      ]);
      setSessions(sess || []);
      const map = {};
      for (const r of revs || []) map[String(r.session_id)] = r;
      setReviewsById(map);
      const plansMap = {};
      for (const p of plans || []) plansMap[p.date] = p;
      setPlansByDate(plansMap);
      setProgrammeContext(settingsRows?.[0]?.programme_context || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Request a coach review for a specific session ----
  const requestReview = async (session) => {
    setBusyId(String(session.id));
    setError(null);
    try {
      // Build recent context — sessions BEFORE this one (so we don't ask the
      // coach to consider the future when reviewing the past).
      const olderSessions = sessions
        .filter((s) => s.date && session.date && s.date < session.date)
        .slice(0, 5);
      const olderReviews = Object.values(reviewsById)
        .filter((r) => r.date && session.date && r.date < session.date)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 5);

      // Pull Strava activities for cardio-relevant sessions only, so
      // strength reviews aren't slowed down by an irrelevant API call.
      const isCardioSession =
        session.day_type === "cardio" ||
        (Array.isArray(session.cardio_activities) && session.cardio_activities.length > 0);
      const stravaActivities = isCardioSession
        ? await fetchStravaForDate(session.date)
        : null;

      const userPrompt = buildReviewPrompt({
        session,
        programmeContext,
        recentSessions: olderSessions,
        recentReviews: olderReviews,
        plannedSession: plansByDate[session.date],
        stravaActivities,
      });
      const replyText = await callClaude(REVIEW_SYSTEM_PROMPT, userPrompt, 1200);
      const json = tryExtractJSON(replyText) || {};

      const row = {
        session_id: String(session.id),
        date: session.date,
        day_id: session.day_id,
        day_name: session.day_name,
        summary: json.summary || "",
        review_text: replyText,
        model: REVIEW_MODEL,
      };
      const created = await sb("/session_reviews", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });
      setReviewsById((prev) => ({ ...prev, [String(session.id)]: created[0] }));
      setExpandedId(String(session.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const deleteReview = async (session) => {
    const sid = String(session.id);
    try {
      await sb(`/session_reviews?session_id=eq.${encodeURIComponent(sid)}`, { method: "DELETE" });
      setReviewsById((prev) => {
        const next = { ...prev };
        delete next[sid];
        return next;
      });
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return <div style={{ padding: "20px", color: T.textSub, fontSize: "13px" }}>Loading sessions…</div>;
  }

  return (
    <div>
      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "10px 12px",
            borderRadius: "8px",
            marginBottom: "12px",
            fontSize: "13px",
            display: "flex",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <div style={{ flex: 1, wordBreak: "break-word" }}>{error}</div>
          <button
            onClick={() => { setError(null); load(); }}
            style={{
              background: "#fff",
              border: "1px solid #fca5a5",
              color: "#991b1b",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            RETRY
          </button>
        </div>
      )}

      {!programmeContext?.trim() && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "10px",
            padding: "10px 12px",
            fontSize: "12px",
            color: "#78350f",
            marginBottom: "16px",
            lineHeight: 1.5,
          }}
        >
          <strong>Tip:</strong> Add your programme context in <strong>Settings → PROGRAMME CONTEXT FOR THE COACH</strong> so the coach can give better-targeted reviews.
        </div>
      )}

      {sessions.length === 0 ? (
        <div
          style={{
            padding: "30px 20px",
            background: T.surface2,
            borderRadius: "10px",
            color: T.textMuted,
            fontSize: "13px",
            textAlign: "center",
          }}
        >
          No sessions logged yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {sessions.map((session) => {
            const sid = String(session.id);
            const review = reviewsById[sid];
            const isBusy = busyId === sid;
            const expanded = expandedId === sid;
            const color = dayColor(session.day_type);
            const reviewJson = review ? tryExtractJSON(review.review_text || "") : null;

            return (
              <div
                key={sid}
                style={{
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderLeft: `4px solid ${color}`,
                  borderRadius: "12px",
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color, fontWeight: 700, letterSpacing: "0.1em" }}>
                      {prettyDate(session.date).toUpperCase()}
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: T.text, marginTop: "2px" }}>
                      {session.day_name || session.day_id || "Session"}
                    </div>
                    <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>
                      {(session.exercises || []).length} exercises
                      {session.rpe != null ? ` · RPE ${session.rpe}` : ""}
                    </div>
                  </div>
                  {review ? (
                    <button
                      onClick={() => setExpandedId(expanded ? null : sid)}
                      style={{
                        background: expanded ? T.text : T.surface2,
                        color: expanded ? "#fff" : T.textSub,
                        border: `1px solid ${expanded ? T.text : T.border}`,
                        borderRadius: "8px",
                        padding: "6px 10px",
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        flexShrink: 0,
                      }}
                    >
                      {expanded ? "HIDE" : "VIEW REVIEW"}
                    </button>
                  ) : (
                    <button
                      onClick={() => requestReview(session)}
                      disabled={!!busyId}
                      style={{
                        background: isBusy ? T.surface2 : T.accent,
                        color: isBusy ? T.textMuted : "#fff",
                        border: "none",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        fontSize: "11px",
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        cursor: busyId ? "wait" : "pointer",
                        fontFamily: "inherit",
                        flexShrink: 0,
                        boxShadow: isBusy ? "none" : "0 2px 6px rgba(234,88,12,0.25)",
                      }}
                    >
                      {isBusy ? "REVIEWING…" : "🧠 GET COACH FEEDBACK"}
                    </button>
                  )}
                </div>

                {/* Review summary line (always visible if review exists) */}
                {review && reviewJson?.summary && (
                  <div
                    style={{
                      marginTop: "10px",
                      fontSize: "13px",
                      color: T.text,
                      fontStyle: "italic",
                      lineHeight: 1.5,
                    }}
                  >
                    {reviewJson.summary}
                  </div>
                )}

                {/* Expanded review detail */}
                {review && expanded && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "#0f172a",
                      color: "#f1f5f9",
                      borderRadius: "10px",
                      padding: "14px",
                      fontSize: "13px",
                      lineHeight: 1.55,
                    }}
                  >
                    {reviewJson ? (
                      <>
                        <ReviewSection label="WHAT WENT WELL" body={reviewJson.what_went_well} color="#86efac" />
                        <ReviewSection label="WHAT TO ADJUST" body={reviewJson.what_to_adjust} color="#fcd34d" />
                        <ReviewSection label="NEXT SESSION" body={reviewJson.next_session_guidance} color="#fb923c" />
                      </>
                    ) : (
                      // Fallback for malformed JSON — show raw text.
                      <div style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: "12px" }}>
                        {review.review_text}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                      <button
                        onClick={() => requestReview(session)}
                        disabled={!!busyId}
                        style={{
                          flex: 1,
                          background: "transparent",
                          border: "1px solid #475569",
                          color: "#e2e8f0",
                          borderRadius: "8px",
                          padding: "8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          cursor: busyId ? "wait" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {isBusy ? "REGENERATING…" : "🔄 REGENERATE"}
                      </button>
                      <button
                        onClick={() => deleteReview(session)}
                        disabled={!!busyId}
                        style={{
                          background: "transparent",
                          border: "1px solid #475569",
                          color: "#94a3b8",
                          borderRadius: "8px",
                          padding: "8px 14px",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          cursor: busyId ? "wait" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        DELETE
                      </button>
                    </div>
                    {review.created_at && (
                      <div style={{ fontSize: "10px", color: "#64748b", marginTop: "8px", textAlign: "right" }}>
                        reviewed {new Date(review.created_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewSection({ label, body, color }) {
  if (!body) return null;
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ fontSize: "10px", letterSpacing: "0.15em", color, fontWeight: 700, marginBottom: "4px" }}>
        {label}
      </div>
      <div style={{ color: "#e2e8f0" }}>{body}</div>
    </div>
  );
}
