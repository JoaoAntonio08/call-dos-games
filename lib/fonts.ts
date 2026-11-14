import { Bricolage_Grotesque, Figtree } from "next/font/google";

/** Títulos e nomes: grotesca moderna, pesada e um pouco condensada. */
export const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  display: "swap",
});

/** Interface e chat: sem serifa humanista, legível em tamanho pequeno. */
export const sans = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});
