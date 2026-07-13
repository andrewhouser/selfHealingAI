import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Person Data Viewer",
  description: "Displays person records from the API project",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
