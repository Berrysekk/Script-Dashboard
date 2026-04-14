import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "./components/AuthGate";
import AppShell from "./components/AppShell";

export const metadata: Metadata = {
  title: "Script Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            if(mq.matches) document.documentElement.classList.add('dark');
            mq.addEventListener('change', function(e){
              document.documentElement.classList.toggle('dark', e.matches);
            });
          })();
        `}} />
      </head>
      <body className="bg-gray-100 dark:bg-neutral-950 text-gray-900 dark:text-gray-100 min-h-screen">
        <header id="topbar" className="h-11 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center px-5 sticky top-0 z-10" />
        <div className="flex h-[calc(100vh-2.75rem)]">
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </div>
      </body>
    </html>
  );
}
