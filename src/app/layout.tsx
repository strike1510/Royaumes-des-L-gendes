import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Royaumes de Légende - Jeu Médiéval-Fantastique",
  description: "Construisez votre village, recrutez des troupes, combattez et régnez ! Jeu multijoueur en temps réel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-[#0d0520] text-amber-100 min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
