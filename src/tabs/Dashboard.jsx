// Placeholder for the Dashboard tab. Real morning briefing pulls from
// Garmin + intake logs + training history + settings + today's plan.
// Built in a later step.
const T = { textMuted: "#94a3b8", text: "#0f172a" };

export default function Dashboard() {
  return (
    <div style={{ padding: "20px", paddingBottom: "100px" }}>
      <div
        style={{
          fontFamily: "'Bebas Neue', cursive",
          fontSize: "36px",
          letterSpacing: "0.05em",
          color: T.text,
        }}
      >
        DASHBOARD
      </div>
      <div
        style={{
          fontSize: "11px",
          color: T.textMuted,
          letterSpacing: "0.15em",
          marginBottom: "30px",
        }}
      >
        MORNING BRIEFING
      </div>
      <div
        style={{
          background: "#f1f5f9",
          border: "1px dashed #cbd5e1",
          borderRadius: "12px",
          padding: "40px 20px",
          textAlign: "center",
          color: T.textMuted,
          fontSize: "14px",
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "8px", color: "#475569" }}>
          Coming soon
        </div>
        Sleep · Body Battery · Today's session · Calories vs target · "Plan today" coach button
      </div>
    </div>
  );
}
