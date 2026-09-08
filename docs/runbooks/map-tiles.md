# Runbook: the basemap

The sites page draws dive sites on a real map. The tiles are images from another
origin, which makes them the only third-party request this application's browser
code makes at all.

## What has to agree

Two things, and they are set in one place — `apps/web/lib/tiles.ts`:

1. **The tile URL** the map requests.
2. **The `img-src` entry** in the Content-Security-Policy, which `next.config.ts`
   builds from the same source.

They were nearly written out separately. Do not separate them: a policy that
does not admit the tiles it is meant to permit produces a grey grid and no error
anywhere, because a blocked image reports nothing to the page, to the console in
production, or to Sentry. It looks exactly like a broken map.

## Configuring a provider

Nothing is required for local development: with no variables set the map uses
OpenStreetMap's own tiles, which need no key.

```bash
MAP_TILE_URL="https://tiles.example.com/{z}/{x}/{y}.png?key=..."
MAP_TILE_ATTRIBUTION="© Example Maps © OpenStreetMap contributors"
MAP_TILE_MAX_ZOOM=19
```

`MAP_TILE_ATTRIBUTION` is not optional when a URL is set, and the application
refuses to start without it. Attribution is a license condition of OpenStreetMap
data and a contractual one for every commercial provider; a map we are not
allowed to show is worse than no map.

The key in a tile URL is public — it is fetched by the browser and visible in
devtools. That is how these providers work; restrict it by HTTP referrer or
allowed origin in the provider's dashboard, and treat it as a rate-limit token
rather than a secret.

## Before production traffic

**Do not ship on OpenStreetMap's own tiles.** Their
[Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) asks
that applications not depend on them; the servers are donated and a product
sending real traffic there is taking capacity from the project that makes every
other option possible. It is the default here so that a fresh clone works, not
because it is the right answer for a deployment.

Providers with a free tier large enough for launch include MapTiler, Stadia Maps
and Carto. Whichever is chosen becomes a **sub-processor**: add it to the table
on `/legal/privacy` and to the section above it, and update
`docs/10-security-privacy.md`. That is a policy change and needs the same care
as any other.

## Turning it off again

The server-rendered SVG plot is still there — it is what shows before Leaflet
loads and what a reader keeps with scripting off. Rendering only that is a
matter of not wrapping it in `SiteTileMap` on the sites page, which is how this
worked until the map was added. If it ever becomes a per-diver setting, that is
the branch it would take.
