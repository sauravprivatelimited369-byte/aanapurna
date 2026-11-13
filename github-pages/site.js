(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const rawBackend = typeof window.ANNAPURNA_BACKEND_URL === "string"
    ? window.ANNAPURNA_BACKEND_URL.trim()
    : "";
  let backend = "";
  try {
    const parsed = new URL(rawBackend);
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      backend = parsed.origin;
    }
  } catch {
    // Leave actions disabled until a valid HTTPS backend URL is configured.
  }

  const accountLinks = document.querySelectorAll(".backend-link");
  const banner = document.querySelector(".backend-banner");
  const bannerTitle = banner?.querySelector("h2");
  const bannerCopy = banner?.querySelector("p:not(.eyebrow)");
  const bannerAction = document.getElementById("configure-backend-link");
  const impactStatus = document.getElementById("impact-state");

  if (!backend) {
    for (const link of accountLinks) {
      link.setAttribute("aria-disabled", "true");
      link.classList.add("is-disabled");
      link.href = "#backend-required";
    }
    banner?.classList.add("is-visible");
    return;
  }

  for (const link of accountLinks) {
    const path = link.dataset.path || "/";
    link.href = `${backend}${path.startsWith("/") ? path : `/${path}`}`;
    link.removeAttribute("aria-disabled");
    link.classList.remove("is-disabled");
  }

  if (banner) banner.classList.add("is-visible");
  if (bannerTitle) bannerTitle.textContent = "The application service is connected.";
  if (bannerCopy) bannerCopy.textContent = "Sign-up, login and operational tools open in the separately hosted Annapurna application.";
  if (bannerAction) {
    bannerAction.href = `${backend}/login`;
    bannerAction.textContent = "Open application ↗";
  }
  if (impactStatus) impactStatus.textContent = "Verified impact totals are shown by the application service when confirmed records are available.";
})();
