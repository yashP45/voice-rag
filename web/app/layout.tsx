import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Bodoni_Moda,
  Noto_Sans_Devanagari,
  Noto_Sans_Tamil,
} from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/* High-contrast didone for display type — the tall, thin-serifed look of the
   HH Goa wordmark. */
const display = Bodoni_Moda({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

/* Without these, Devanagari and Tamil fall back to whatever the OS supplies —
   usually metrics that clip matras and descenders. */
const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "600"],
});
const tamil = Noto_Sans_Tamil({
  variable: "--font-tamil",
  subsets: ["tamil"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Voice RAG · HH Goa",
  description:
    "Voice-enabled retrieval-augmented generation over MSMARCO-XI — multi-strategy chunking, FAISS, guardrails.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${devanagari.variable} ${tamil.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
