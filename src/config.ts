// Two different origins are in play, so two base paths:
//
// DATA_BASE — content that lives at the slashie.net site ROOT: projects.json and
//   the /img/... images. In dev these route through the Vite proxy (/slashie → …);
//   in a production build they are same-origin at the root (the app is hosted on
//   slashie.net), so no proxy and no CORS are needed.
//
// ASSET_BASE — this app's OWN bundled/public assets (the fallback snapshot, the
//   custom NPC photos in public/people). Vite serves these under its `base`, which
//   is "/keep/" in the production build and "/" in dev — exactly BASE_URL.
export const DATA_BASE = import.meta.env.DEV ? '/slashie/' : '/';
export const ASSET_BASE = import.meta.env.BASE_URL;
