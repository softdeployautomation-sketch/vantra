import type { Metadata } from "next";

import { ToastProvider } from "@/components/toast";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Vantra",
    template: "%s · Vantra",
  },
  description:
    "Vantra — secure, branded device monitoring for your fleet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark-by-default with a per-browser toggle. Read localStorage before
            first paint to avoid a flash-of-wrong-theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("vantra-theme");var d=t==="dark"||(!t&&true);document.documentElement.classList.toggle("dark",d);}catch(e){document.documentElement.classList.add("dark");}})();`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}