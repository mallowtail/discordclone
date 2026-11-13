import type { NextConfig } from "next";

// Safety headers on every page.
// - frame-ancestors / X-Frame-Options: no other site may show this app inside a frame (stops
//   "clickjacking" — an invisible copy of the app placed over a page to trick people into clicks).
// - object-src / base-uri / form-action: shut off old plugin embeds and <base>/form hijacking, none
//   of which the app uses. (A full script/style CSP isn't set: it needs nonces to work with Next.)
// - nosniff: browsers must trust the declared file type rather than guess (uploads stay downloads).
// - Referrer-Policy: other sites see only our domain, not full URLs with channel/conversation ids.
// - Permissions-Policy: the app never needs the camera, microphone or location.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
