import type { Metadata } from "next";
import "./globals.css";
import { CsrfGuard } from "@/components/security/CsrfGuard";

export const metadata: Metadata = {
  title: "ALO Labs - Bring Your Idea Online With a Website",
  description: "ALO Labs offers premium web hosting, domain registration, website builder, and AI-powered tools to help you build and grow your online presence.",
  keywords: ["ALO Labs", "web hosting", "domain", "website builder", "VPS", "cloud hosting", "WordPress"],
  authors: [{ name: "ALO Labs" }],
  icons: {
    icon: "/alolabs-agentos-mark.png",
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
      <body className="antialiased" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        {/* Issues the CSRF cookie and patches window.fetch so every existing
            same-origin mutation carries the token. Renders nothing. */}
        <CsrfGuard />
        {children}
      </body>
    </html>
  );
}
