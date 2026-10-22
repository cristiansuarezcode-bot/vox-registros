import type { Metadata, Viewport } from 'next';
import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'Registros Vox',
  description: 'Registros administrativos de Vox Corpus Danza',
  robots: { index: false, follow: false },
  icons: { icon: base + '/favicon-vox-v2.png', apple: base + '/favicon-vox-v2.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Condensed:wght@700&display=swap" />
      </head>
      <body style={{ ['--logo' as string]: `url(${base}/vox-corpus-logo.png)` }}>{children}</body>
    </html>
  );
}
