import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FinCore - Digital Wallet & Payment Platform',
  description: 'FinCore Digital Wallet, Ledger & Payment Processing Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
