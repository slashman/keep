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
export const ASSET_BASE = import.meta.env.BASE_URL;

// Prod: data/images live under /keep via server symlinks (keep/data → ../data,
//   keep/img → ../img), so the same base as our own assets — the browser's
//   bot-challenge cookie (path=/keep) already covers them.
// Dev: there are no symlinks and no browser to solve the challenge, so route
//   through the Vite proxy (/slashie → slashie.net) which injects the cookie
//   server-side. See vite.config.ts.
export const DATA_BASE = import.meta.env.DEV ? '/slashie/' : ASSET_BASE;

// EMBED_CHECK_URL — the server-side header check that reports whether a link can be
// shown inside the in-app popup iframe (see public/embeddable.php). It ships beside
// the app under /keep in production. Vite can't run PHP in dev, so we route to the
// deployed copy through the /keep-api proxy (see vite.config.ts); if it isn't
// deployed yet the client's fetch just fails and the popup falls back to attempting
// the frame anyway.
export const EMBED_CHECK_URL = import.meta.env.DEV
  ? '/keep-api/embeddable.php'
  : `${ASSET_BASE}embeddable.php`;