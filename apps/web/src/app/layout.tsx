import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './Providers';

export const metadata: Metadata = {
  title: 'FinCore - Digital Wallet & Payment Platform',
  description: 'FinCore Digital Wallet, Ledger & Payment Processing Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
