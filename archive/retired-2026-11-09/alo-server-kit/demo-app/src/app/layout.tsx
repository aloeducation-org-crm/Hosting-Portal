import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'ALO Demo App',
  description: 'Demo Next.js app for alo-server-kit'
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
