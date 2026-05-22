import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

export const metadata: Metadata = { title: "Chat", description: "Group chat" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#313338] text-[#dbdee1] antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
