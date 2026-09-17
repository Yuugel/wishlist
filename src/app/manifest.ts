import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wishlist",
    short_name: "Wishlist",
    description: "Der persönliche Ort für Wünsche, Gruppen und gut gehütete Überraschungen.",
    lang: "de",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffaf4",
    theme_color: "#fffaf4",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
