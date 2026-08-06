import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { ThemeToggle } from './theme-toggle';

export const metadata: Metadata = {
  title: 'MIP — AI Market Intelligence',
  description: 'AI-powered market intelligence: TA + SMC analysis, alerts, and briefings.',
};

const themeInit = `(function(){try{var t=localStorage.getItem('mip-theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="dot" />
            MIP <span style={{ color: 'var(--faint)', fontWeight: 500 }}>· AI Market Intelligence</span>
          </div>
          <nav className="nav">
            <Link href="/">Overview</Link>
          </nav>
          <div className="spacer" />
          <span className="dev-badge">DEV MODE · no auth</span>
          <ThemeToggle />
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
