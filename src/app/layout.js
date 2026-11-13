import { Inter } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "Aries - AI Infrastructure Management",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply persisted theme before first paint (Seren) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=JSON.parse(localStorage.getItem('theme')||'null');var t=s&&s.state&&s.state.theme;document.documentElement.classList.add('dark');if(t==='glass')document.documentElement.classList.add('glass');else if(t==='pop')document.documentElement.classList.add('pop');else if(t==='marine')document.documentElement.classList.add('marine')}catch(e){document.documentElement.classList.add('dark')}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            /* Reveal icon glyphs once the icon font is usable. document.fonts.ready
               settles when font loading is idle, which is later and more reliable
               than a single load() callback (that one can resolve before the woff2
               is decoded). setTimeout is the backstop: icons must never stay at
               opacity 0 just because the font request was slow or failed. */
            __html: `var d=document,r=d.documentElement;r.classList.add('fonts-loading');var f=function(){r.classList.add('fonts-loaded');r.classList.remove('fonts-loading')};if(d.fonts&&d.fonts.ready){d.fonts.ready.then(f).catch(f);setTimeout(f,1500)}else{f()}`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
        <GoogleAnalytics gaId={"G-LC959F603F"} />
      </body>
    </html>
  );
}
