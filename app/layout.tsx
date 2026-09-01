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
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}