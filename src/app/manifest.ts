import type { MetadataRoute } from "next";

/**
 * The web app manifest.
 *
 * It exists for one concrete reason: notifications on an iPhone or iPad. Safari there offers the Push
 * API only to a site that has been added to the Home Screen and opens as its own app. From iOS 16.4
 * up to iOS 18, what makes a Home Screen icon open that way is a manifest whose `display` is
 * `standalone` or `fullscreen`; without one the icon is a bookmark that opens in the browser, where
 * there is no push (WebKit, "Web Push for Web Apps on iOS and iPadOS",
 * https://webkit.org/blog/13878/). From iOS 26 opening as a web app is the default, and this file
 * still supplies the name, the icon and where the app starts. Without it the Notifications page could
 * only tell an iPhone user that their browser cannot receive notifications, which is not true of the
 * device.
 *
 * It is not a claim that the site works offline. The service worker caches nothing, deliberately: a
 * stale page here could show a food offer that has already been collected.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Annapurna Link",
    short_name: "Annapurna",
    description: "A community-first platform for accountable food redistribution, from a verified offer to a confirmed handover.",
    // The signed-in workspace. Somebody who is not signed in is sent to the sign-in page from there.
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The same artwork: a full-bleed background with the mark in the central half, so a launcher
      // that crops to a circle or a squircle cuts background, not the mark.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
