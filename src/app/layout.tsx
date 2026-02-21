import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "סוכן ווטסאפ — דשבורד עסקי",
  description:
    "דשבורד עסקי לניהול סוכן AI לשירות לקוחות בוואטסאפ.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
