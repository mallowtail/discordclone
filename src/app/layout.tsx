import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://mallowchat.vercel.app"),
  title: {
    default: "Mallowchat",
    template: "%s · Mallowchat",
  },
  description: "Real-time group chat with servers, channels, and DMs.",
  openGraph: {
    title: "Mallowchat",
    description: "Real-time group chat with servers, channels, and DMs.",
    siteName: "Mallowchat",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1b1e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-app text-ink antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
