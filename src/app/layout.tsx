import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Annapurna Link — Share Every Meal. Waste Nothing.",
    template: "%s · Annapurna Link",
  },
  description: "A community-first platform for accountable food redistribution, from a verified offer to a confirmed handover.",
  applicationName: "Annapurna Link",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0C",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
