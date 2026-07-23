import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart House",
  description: "Control simple y seguro para una casa conectada.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
