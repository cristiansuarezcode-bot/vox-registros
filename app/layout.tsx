import type { Metadata, Viewport } from 'next';
import './globals.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'Registros Vox',
  description: 'Registros administrativos de Vox Corpus Danza',
  robots: { index: false, follow: false },
  icons: { icon: base + '/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f1229' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
