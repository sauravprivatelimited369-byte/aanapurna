import type { Metadata, Viewport } from "next";
import { currentLocale } from "@/lib/locale-server";
import { htmlLang } from "@/lib/i18n";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The language attribute tells a screen reader which voice to use. Latin script announced with an
  // English voice is unintelligible, so this follows the reader's choice rather than assuming.
  const locale = await currentLocale();
  return (
    <html lang={htmlLang(locale)}>
      <body>{children}</body>
    </html>
  );
}
