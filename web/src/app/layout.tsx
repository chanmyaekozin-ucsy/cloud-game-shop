import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { headers } from "next/headers";
import { AuthProvider } from "@/components/Auth";
import "./globals.css";

const display = localFont({
  src: "./fonts/A16_ThuNgalTan-Regular.ttf",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cloud Game Shop",
  description: "MLBB top-up mini app for WathanPay",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#102A43",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Middleware generates a per-request CSP nonce; the WathanPay SDK script
  // must carry it because 'strict-dynamic' ignores host allowlists.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        <Script
          src="https://api.wathanpay.com/sdk.js"
          strategy="beforeInteractive"
          nonce={nonce}
        />
      </head>
      <body className={`${display.className} ${display.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
