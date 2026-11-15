import type { MetadataRoute } from "next";

/** Manifesto do app: deixa "instalar" pelo Chrome e é a base do app de Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Call dos Games",
    short_name: "Call dos Games",
    description: "O cantinho da turma: servidores, chat, call com tela, soundboard e YouTube junto.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1f2023",
    theme_color: "#18191c",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
