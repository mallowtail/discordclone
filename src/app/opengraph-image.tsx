import { ImageResponse } from "next/og";

export const alt = "Mallowchat: real-time group chat with servers, channels, and DMs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          background: "#1a1b1e",
          color: "#f2f3f5",
          padding: "0 96px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 16,
            background: "#7c9cff",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 112, fontWeight: 700, letterSpacing: -3, display: "flex" }}>
            Mallowchat
          </div>
          <div style={{ fontSize: 36, color: "#9aa0a8", marginTop: 20, display: "flex", maxWidth: 640 }}>
            Real-time group chat with servers, channels, and DMs.
          </div>
        </div>
        <svg width="280" height="280" viewBox="0 0 32 32">
          <path
            fill="#7c9cff"
            d="M9 7h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5.5 4.5a.6.6 0 0 1-1-.46V23H9a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z"
          />
          <circle cx="12" cy="15" r="1.7" fill="#1a1b1e" />
          <circle cx="16" cy="15" r="1.7" fill="#1a1b1e" />
          <circle cx="20" cy="15" r="1.7" fill="#1a1b1e" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
