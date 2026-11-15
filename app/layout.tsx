import type { Metadata, Viewport } from "next";
import { display, sans } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Call dos Games",
  description: "O cantinho da turma: servidores, chat, call com tela até 4K, soundboard e YouTube sincronizado.",
  icons: {
    icon: [{ url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Call dos Games", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#18191c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
