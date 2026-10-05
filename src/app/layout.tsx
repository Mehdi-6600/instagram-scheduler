import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Instagram Scheduler",
  description:
    "Personal Instagram post scheduler — connect your account, schedule photos with captions, and publish automatically.",
  applicationName: "My Instagram Scheduler",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "IG Scheduler",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b11" },
  ],
};

const themeInit = `(function(){try{var t=localStorage.getItem("mis_theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
