import type { AppProps } from 'next/app';
import { Inter } from 'next/font/google';
import '../styles/globals.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-inter' });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <main className={inter.variable}>
      <Component {...pageProps} />
    </main>
  );
}
