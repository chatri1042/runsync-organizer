import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RunSync Organizer',
  description: 'Race Command Center for Event Organizers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="h-screen overflow-hidden bg-bg text-white antialiased">
        {children}
      </body>
    </html>
  );
}
