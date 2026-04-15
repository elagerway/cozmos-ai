import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { UpdateBanner } from "@/components/UpdateBanner"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Biosphere — AI-Powered 360° Sphere Generation",
  description:
    "Describe your campaign in plain English. Get a fully-rendered interactive 360° sphere in under 90 seconds.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-[family-name:var(--font-inter)]">
        <UpdateBanner />
        {children}
      </body>
    </html>
  )
}
