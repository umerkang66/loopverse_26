import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'ARES ACCORD · Mission Control',
  description: 'Mars colony crisis council: five AI agents negotiate scarce resources under a deterministic validator.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster theme="dark" richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
