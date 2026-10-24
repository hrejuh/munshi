import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Munshi",
  description: "Every shop's AI munshi. Talk to it, and it runs your shop online.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2b705",
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Baloo+Tamma+2:wght@500;700;800&family=Baloo+Thambi+2:wght@500;700;800&family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Kannada:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&family=Noto+Sans+Tamil:wght@400;600&display=swap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
