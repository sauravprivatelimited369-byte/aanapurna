// The account service behind this site.
//
// The Pages workflow copies this file into the published site and only replaces
// the value when the ANNAPURNA_BACKEND_URL repository variable is set, so the
// link lives in version control instead of in a settings-only field. The live
// application runs on Vercel; the Pages site points its sign-in and
// access-request controls, and its "open application" action, at it.
window.ANNAPURNA_BACKEND_URL = "https://annapurna-link.vercel.app";
