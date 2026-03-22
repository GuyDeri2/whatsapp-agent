import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { InactivityGuard } from "@/components/InactivityGuard";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "סוכן ווטסאפ — דשבורד עסקי",
  description: "דשבורד עסקי לניהול סוכן AI לשירות לקוחות בוואטסאפ. המערכת המקצועית ביותר בישראל.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${inter.variable} ${outfit.variable} antialiased`}>
      <body className="font-sans bg-background text-foreground selection:bg-accent/30 selection:text-white">
        <InactivityGuard />
        {children}
      </body>
    </html>
  );
}
