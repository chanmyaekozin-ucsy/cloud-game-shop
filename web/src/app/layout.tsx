import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script src="https://api.wathanpay.com/sdk.js" strategy="beforeInteractive" />
      </head>
      <body className={`${display.className} ${display.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
