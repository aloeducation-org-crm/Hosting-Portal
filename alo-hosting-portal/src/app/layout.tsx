import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ALO Labs - Bring Your Idea Online With a Website",
  description: "ALO Labs offers premium web hosting, domain registration, website builder, and AI-powered tools to help you build and grow your online presence.",
  keywords: ["ALO Labs", "web hosting", "domain", "website builder", "VPS", "cloud hosting", "WordPress"],
  authors: [{ name: "ALO Labs" }],
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>⚡</text></svg>",
  },
  openGraph: {
    title: "ALO Labs - Bring Your Idea Online With a Website",
    description: "Premium web hosting, domains, and AI-powered tools to grow your online presence.",
    url: "https://alolabs.net",
    siteName: "ALO Labs",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}