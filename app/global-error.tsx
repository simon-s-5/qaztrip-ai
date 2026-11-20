"use client"; // Last-resort boundary: renders its own document if even the root layout fails.

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f6f5f1",
          color: "#18211f",
          padding: 16,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <title>QazTrip AI</title>
          <p style={{ fontWeight: 600 }}>Something went wrong. Please try again.</p>
          <p style={{ color: "#5f6b67", fontSize: 14 }}>Қате шықты. Қайталап көріңіз.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 12,
              background: "#0f6b63",
              color: "#fff",
              border: 0,
              borderRadius: 12,
              padding: "10px 18px",
              fontWeight: 600,
            }}
          >
            Try again / Қайталау
          </button>
        </div>
      </body>
    </html>
  );
}
