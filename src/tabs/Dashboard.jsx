// Placeholder for the Dashboard tab. Real morning briefing pulls from
// Garmin + intake logs + training history + settings + today's plan.
// Built in a later step.

const T = {
  text: "#0f172a",
  textSub: "#475569",
  textMuted: "#94a3b8",
  accent: "#ea580c",
  surface: "#ffffff",
  surface2: "#f1f5f9",
  border: "#cbd5e1",
};

const display = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: "0.04em",
  color: T.text,
  lineHeight: 1,
};

export default function Dashboard() {
  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      {/* ---- App brand ---- */}
      <div style={{ ...display, fontSize: "44px", marginBottom: "4px" }}>
        COACH CLAUDE
      </div>
      <div
        style={{
          fontSize: "10px",
          color: T.textMuted,
          letterSpacing: "0.2em",
          fontWeight: 700,
          marginBottom: "28px",
        }}
      >
        TRAIN · EAT · RECOVER · REPEAT
      </div>

      {/* ---- Section title ---- */}
      <div style={{ ...display, fontSize: "28px", marginBottom: "4px" }}>
        TODAY
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          fontWeight: 600,
          marginBottom: "20px",
        }}
      >
        MORNING BRIEFING
      </div>

      <div
        style={{
          background: T.surface2,
          border: `1px dashed ${T.border}`,
          borderRadius: "12px",
          padding: "40px 20px",
          textAlign: "center",
          color: T.textMuted,
          fontSize: "14px",
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "8px", color: T.textSub }}>
          Coming soon
        </div>
        Sleep · Body Battery · Today's session · Calories vs target · "Plan today" coach button
      </div>
    </div>
  );
}
