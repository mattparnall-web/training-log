import { useState, useEffect, useCallback } from "react";
import {
  sb, T, display,
  todayString, shiftDate, startOfDayLocal, endOfDayLocal,
  prettyDate, dateStrOf,
  DateBar,
} from "./_shared.jsx";

// Weekly programme — mirrors WorkoutTracker's DAYS constant so we can compute
// "today's planned session" without importing from the workout file.
const DAYS = [
  { id: "monday",    label: "MON", name: "Upper Push",          type: "upper_push",  color: "#7c3aed" },
  { id: "tuesday",   label: "TUE", name: "Upper Pull + Deads",  type: "upper_pull",  color: "#0891b2" },
  { id: "wednesday", label: "WED", name: "Active Recovery",     type: "recovery",    color: "#16a34a" },
  { id: "thursday",  label: "THU", name: "Lower — Squat",       type: "lower_squat", color: "#2563eb" },
  { id: "friday",    label: "FRI", name: "Flexible",            type: "flexible",    color: "#94a3b8" },
  { id: "saturday",  label: "SAT", name: "Olympic + MetCon",    type: "olympic",     color: "#dc2626" },
  { id: "sunday",    label: "SUN", name: "Zone 2 Cardio",       type: "cardio",      color: "#16a34a" },
];

function dayDefFor(dateStr) {
  // Monday-indexed lookup
  const dt = startOfDayLocal(dateStr);
  const idx = (dt.getDay() + 6) % 7;
  return DAYS[idx];
}

// ---------- Defensive extractors for Garmin response shapes ----------
function pickSleep(section) {
  const d = section?.data;
  if (!d) return null;
  const dto = d.dailySleepDTO || d;
  const score =
    dto?.sleepScores?.overall?.value ??
    dto?.sleepScores?.overall?.qualifierKey ??
    dto?.sleepScoreFeedback ??
    null;
  return {
    duration_seconds: dto?.sleepTimeSeconds ?? null,
    deep_seconds: dto?.deepSleepSeconds ?? null,
    light_seconds: dto?.lightSleepSeconds ?? null,
    rem_seconds: dto?.remSleepSeconds ?? null,
    awake_seconds: dto?.awakeSleepSeconds ?? null,
    score,
  };
}

function pickBodyBattery(section) {
  const d = section?.data;
  if (!d) return null;
  // get_body_battery returns either a list of day-arrays or a single day shape.
  const day = Array.isArray(d) ? d[0] : d;
  if (!day) return null;
  const values = day.bodyBatteryValuesArray || day.bodyBatteryValues || [];
  let max = null, min = null, current = null;
  for (const row of values) {
    const v = Array.isArray(row) ? row[1] : row?.value;
    if (typeof v !== "number") continue;
    if (max == null || v > max) max = v;
    if (min == null || v < min) min = v;
    current = v;
  }
  return {
    charged: day.charged ?? null,
    drained: day.drained ?? null,
    current,
    max,
    min,
  };
}

function pickHRV(section) {
  const d = section?.data;
  if (!d) return null;
  const s = d.hrvSummary || d;
  return {
    last_night_avg: s.lastNightAvg ?? null,
    last_night_high: s.lastNightHigh ?? null,
    weekly_avg: s.weeklyAvg ?? null,
    status: s.status ?? null,
    baseline_low: s.baseline?.lowUpper ?? null,
    baseline_balanced_low: s.baseline?.balancedLow ?? null,
    baseline_balanced_upper: s.baseline?.balancedUpper ?? null,
  };
}

function pickReadiness(section) {
  const d = section?.data;
  if (!d) return null;
  const r = Array.isArray(d) ? d[0] : d;
  if (!r) return null;
  return {
    score: r.score ?? null,
    level: r.level ?? null,
    feedback: r.feedbackLong || r.feedbackShort || null,
    sleep_score: r.sleepScore ?? null,
    hrv_factor: r.hrvFactorPercent ?? null,
    recovery_time: r.recoveryTime ?? null,
  };
}

function pickTrainingStatus(section) {
  const d = section?.data;
  if (!d) return null;
  // The structure varies across firmwares. Try common shapes.
  const latest = d?.mostRecentTrainingStatus?.latestTrainingStatusData;
  if (latest) {
    const firstDevice = Object.values(latest)[0];
    return {
      status: firstDevice?.trainingStatus ?? null,
      load: firstDevice?.acwrFlash?.value ?? firstDevice?.weeklyTrainingLoad ?? null,
      feedback: firstDevice?.trainingStatusFeedbackPhrase ?? null,
    };
  }
  return null;
}

function pickDailySummary(section) {
  const d = section?.data;
  if (!d) return null;
  return {
    steps: d.totalSteps ?? d.dailyStepGoalRaw ?? null,
    step_goal: d.dailyStepGoal ?? null,
    active_calories: d.activeKilocalories ?? null,
    intensity_minutes: (d.moderateIntensityMinutes ?? 0) + (d.vigorousIntensityMinutes ?? 0) * 2,
    resting_heart_rate: d.restingHeartRate ?? null,
  };
}

// ---------- Formatters ----------
function hoursMinutes(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds - h * 3600) / 60);
  return `${h}h ${m}m`;
}
function valueOrDash(v, unit = "") {
  return v == null ? "—" : `${v}${unit}`;
}

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(todayString());
  const yesterdayStr = shiftDate(selectedDate, -1);

  const [garmin, setGarmin] = useState(null);
  const [garminLoading, setGarminLoading] = useState(true);
  const [garminError, setGarminError] = useState(null);

  const [settings, setSettings] = useState(null);
  const [foodYesterday, setFoodYesterday] = useState([]);
  const [alcoholYesterday, setAlcoholYesterday] = useState([]);
  const [intakeLoading, setIntakeLoading] = useState(true);

  const isToday = selectedDate === todayString();
  const day = dayDefFor(selectedDate);

  // ---- Fetch the Garmin morning brief for the selected date ----
  const loadGarmin = useCallback(async () => {
    setGarminLoading(true);
    setGarminError(null);
    try {
      const r = await fetch(`/api/garmin-data?date=${selectedDate}`);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Garmin proxy ${r.status}: ${t.slice(0, 200)}`);
      }
      setGarmin(await r.json());
    } catch (e) {
      setGarminError(e.message);
      setGarmin(null);
    } finally {
      setGarminLoading(false);
    }
  }, [selectedDate]);

  // ---- Fetch settings + yesterday's intake from Supabase ----
  const loadIntake = useCallback(async () => {
    setIntakeLoading(true);
    try {
      const [settingsRows, food, drinks] = await Promise.all([
        sb("/settings?select=*&id=eq.1"),
        sb(
          `/food_entries?select=*&consumed_at=gte.${startOfDayLocal(yesterdayStr).toISOString()}&consumed_at=lte.${endOfDayLocal(yesterdayStr).toISOString()}`
        ),
        sb(
          `/alcohol_entries?select=*&consumed_at=gte.${startOfDayLocal(yesterdayStr).toISOString()}&consumed_at=lte.${endOfDayLocal(yesterdayStr).toISOString()}`
        ),
      ]);
      setSettings(settingsRows?.[0] || null);
      setFoodYesterday(food || []);
      setAlcoholYesterday(drinks || []);
    } catch (e) {
      // Non-fatal — dashboard still renders Garmin data.
      console.error("intake load failed:", e);
    } finally {
      setIntakeLoading(false);
    }
  }, [yesterdayStr]);

  useEffect(() => { loadGarmin(); }, [loadGarmin]);
  useEffect(() => { loadIntake(); }, [loadIntake]);

  // ---- Derived values ----
  const sleep = pickSleep(garmin?.sleep);
  const bb = pickBodyBattery(garmin?.body_battery);
  const hrv = pickHRV(garmin?.hrv);
  const readiness = pickReadiness(garmin?.training_readiness);
  const trainingStatus = pickTrainingStatus(garmin?.training_status);
  const daily = pickDailySummary(garmin?.daily_summary);

  const yCalories = Math.round(foodYesterday.reduce((a, e) => a + Number(e.calories || 0), 0));
  const yProtein = Math.round(foodYesterday.reduce((a, e) => a + Number(e.protein_g || 0), 0));
  const yUnits = round1(alcoholYesterday.reduce((a, e) => a + Number(e.units || 0), 0));
  const yDrinks = alcoholYesterday.length;

  const calTarget = settings?.daily_calorie_target;
  const proteinTarget = settings?.daily_protein_target_g;
  const keyLifts = Array.isArray(settings?.key_lifts) ? settings.key_lifts : [];

  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      {/* ---- Brand ---- */}
      <div style={{ ...display, fontSize: "44px", marginBottom: "4px" }}>
        COACH CLAUDE
      </div>
      <div
        style={{
          fontSize: "10px",
          color: T.textMuted,
          letterSpacing: "0.2em",
          fontWeight: 700,
          marginBottom: "20px",
        }}
      >
        TRAIN · EAT · RECOVER · REPEAT
      </div>

      {/* ---- Date bar ---- */}
      <DateBar value={selectedDate} onChange={setSelectedDate} />

      <div style={{ ...display, fontSize: "26px", marginBottom: "4px" }}>
        {isToday ? "TODAY" : prettyDate(selectedDate).toUpperCase()}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          fontWeight: 600,
          marginBottom: "16px",
        }}
      >
        MORNING BRIEFING
      </div>

      {/* ---- Today's session card ---- */}
      <Card>
        <CardLabel>SESSION</CardLabel>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px" }}>
          <div style={{ fontSize: "20px", fontWeight: 700, color: day.color }}>{day.name}</div>
          <div style={{ fontSize: "12px", color: T.textMuted, letterSpacing: "0.1em", fontWeight: 700 }}>{day.label}</div>
        </div>
        {readiness?.score != null && (
          <div style={{ fontSize: "12px", color: T.textSub, marginTop: "8px" }}>
            <strong>Readiness {readiness.score}/100</strong>
            {readiness.level ? ` · ${readiness.level}` : ""}
            {readiness.feedback ? <div style={{ marginTop: "4px", color: T.textMuted, fontStyle: "italic" }}>{readiness.feedback}</div> : null}
          </div>
        )}
        {keyLifts.length > 0 && (
          <div style={{ marginTop: "10px", borderTop: `1px solid ${T.border}`, paddingTop: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: T.textMuted, fontWeight: 700, marginBottom: "6px" }}>
              KEY LIFT TARGETS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {keyLifts.map((l, i) => (
                <div
                  key={i}
                  style={{
                    background: T.surface2,
                    border: `1px solid ${T.border}`,
                    borderRadius: "6px",
                    padding: "4px 8px",
                    fontSize: "12px",
                    color: T.text,
                  }}
                >
                  <strong>{l.name}</strong>
                  {l.target_kg != null ? <span style={{ color: T.textMuted }}> · {l.target_kg}kg</span> : null}
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          disabled
          title="Coming in the next step — Claude reviews your data and proposes today's session"
          style={{
            marginTop: "14px",
            width: "100%",
            padding: "12px",
            background: T.surface2,
            border: `1px dashed ${T.border2}`,
            color: T.textMuted,
            borderRadius: "10px",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            cursor: "not-allowed",
          }}
        >
          ⏳ PLAN TODAY'S SESSION (coming next)
        </button>
      </Card>

      {/* ---- Garmin recovery cards ---- */}
      <Card>
        <CardLabel>RECOVERY</CardLabel>
        {garminLoading ? (
          <div style={{ fontSize: "13px", color: T.textSub }}>Fetching Garmin data…</div>
        ) : garminError ? (
          <div style={{ fontSize: "12px", color: T.warn, background: "#fee2e2", padding: "8px 10px", borderRadius: "6px" }}>
            {garminError}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Metric
              label="SLEEP"
              big={hoursMinutes(sleep?.duration_seconds)}
              sub={sleep?.score != null ? `Score: ${sleep.score}` : null}
            />
            <Metric
              label="BODY BATTERY"
              big={valueOrDash(bb?.current ?? bb?.max)}
              sub={bb?.max != null && bb?.min != null ? `${bb.min}–${bb.max}` : null}
            />
            <Metric
              label="HRV (LAST NIGHT)"
              big={valueOrDash(hrv?.last_night_avg, "ms")}
              sub={hrv?.status ? hrv.status : (hrv?.weekly_avg != null ? `7d avg ${hrv.weekly_avg}` : null)}
            />
            <Metric
              label="TRAINING STATUS"
              big={trainingStatus?.status || "—"}
              sub={trainingStatus?.feedback ? trainingStatus.feedback.slice(0, 60) : null}
            />
          </div>
        )}
      </Card>

      {/* ---- Yesterday's intake ---- */}
      <Card>
        <CardLabel>YESTERDAY'S INTAKE</CardLabel>
        {intakeLoading ? (
          <div style={{ fontSize: "13px", color: T.textSub }}>Loading…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            <Metric
              label="CALORIES"
              big={yCalories || "—"}
              sub={calTarget ? `of ${calTarget}` : null}
              tone={calTarget == null ? null : yCalories < 0.9 * calTarget ? "under" : yCalories <= 1.05 * calTarget ? "ok" : "over"}
            />
            <Metric
              label="PROTEIN (G)"
              big={yProtein || "—"}
              sub={proteinTarget ? `of ${proteinTarget}` : null}
              tone={proteinTarget == null ? null : yProtein < 0.8 * proteinTarget ? "under" : "ok"}
            />
            <Metric
              label="DRINKS"
              big={yDrinks || "0"}
              sub={yUnits ? `${yUnits} units` : null}
              tone={yUnits === 0 ? "ok" : yUnits < 4 ? "ok" : yUnits < 8 ? "over" : "over"}
            />
          </div>
        )}
      </Card>

      {/* ---- Today's activity (selected date) ---- */}
      {daily && (
        <Card>
          <CardLabel>{isToday ? "TODAY · ACTIVITY" : prettyDate(selectedDate).toUpperCase()}</CardLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Metric
              label="STEPS"
              big={valueOrDash(daily.steps)}
              sub={daily.step_goal ? `Goal ${daily.step_goal}` : null}
            />
            <Metric
              label="RESTING HR"
              big={valueOrDash(daily.resting_heart_rate, " bpm")}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- Helper components ----
function Card({ children }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: "12px",
        padding: "14px",
        marginBottom: "12px",
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }) {
  return (
    <div
      style={{
        fontSize: "10px",
        letterSpacing: "0.2em",
        color: T.textMuted,
        fontWeight: 700,
        marginBottom: "10px",
      }}
    >
      {children}
    </div>
  );
}

function Metric({ label, big, sub, tone }) {
  const toneColor =
    tone === "under" ? T.amber :
    tone === "over"  ? T.warn :
    tone === "ok"    ? T.ok : T.text;
  return (
    <div>
      <div
        style={{
          fontSize: "9px",
          letterSpacing: "0.15em",
          color: T.textMuted,
          fontWeight: 700,
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: toneColor, lineHeight: 1 }}>
        {big}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "3px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
