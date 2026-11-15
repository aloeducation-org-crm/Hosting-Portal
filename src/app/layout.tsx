import type { Metadata } from "next";
import "./globals.css";
import { CsrfGuard } from "@/components/security/CsrfGuard";

export const metadata: Metadata = {
  title: "ALO Labs — Hosting Control Plane & Engineering Platform",
  description:
    "ALO Labs operates self-managed web hosting, domains, TLS certificates, databases, backups, and AI engineering workflows for ALO Group systems and managed clients.",
  keywords: [
    "ALO Labs",
    "hosting control plane",
    "domain management",
    "cloud platform",
    "Next.js hosting",
    "AI operations",
  ],
  authors: [{ name: "ALO Labs" }],
  icons: {
    icon: "/alolabs-agentos-mark.png",
  },
  openGraph: {
    title: "ALO Labs — Hosting Control Plane & Engineering Platform",
    description:
      "Self-operated hosting control plane, domains, TLS lifecycle, databases, and AI operations by ALO Labs.",
    url: "https://hosting.alolabs.net",
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
