import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JimsSheet — Drop a database. Get a spreadsheet.",
  description:
    "Upload any database file — SQLite, MySQL dump, PostgreSQL dump, CSV, and more. JimsSheet automatically detects the format and converts it to a professionally formatted Excel workbook. 100% in-browser, no upload required.",
  keywords: ["database to excel", "sqlite to xlsx", "sql dump converter", "database converter", "spreadsheet"],
  authors: [{ name: "JimsSheet" }],
  robots: "index, follow",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
