import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wishlist",
  description: "Der persönliche Ort für Wünsche, Gruppen und gut gehütete Überraschungen.",
  applicationName: "Wishlist",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#fffaf4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="de" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
