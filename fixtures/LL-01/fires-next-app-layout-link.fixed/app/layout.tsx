import type { ReactNode } from 'react';
import { Playfair_Display } from 'next/font/google';
import './globals.css';

const playfair = Playfair_Display({ subsets: ['latin'], weight: '700', variable: '--font-playfair' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={playfair.variable}>
      <body>{children}</body>
    </html>
  );
}
