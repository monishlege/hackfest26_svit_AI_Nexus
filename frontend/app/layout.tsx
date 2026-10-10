import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataSynth & Query AI",
  description: "Explore, understand, and augment your data with AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
