'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LatLngBounds, Map as LeafletMap } from 'leaflet';

export type MappedSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  dives: number;
};

/**
 * A real basemap, over the plot that was there before.
 *
 * Progressive enhancement rather than replacement. The server already renders
 * an SVG plot of these same coordinates, and it is handed in as `children`:
 * it is what a diver sees before Leaflet has loaded, what they keep if the
 * bundle never arrives, and what remains when scripting is off. Swapping it
 * for an empty div that a script might one day fill would trade a page that
 * always works for one that usually does.
 *
 * Leaflet is bundled, not fetched from a CDN — `script-src` is `'self'` and
 * that is worth keeping true for scripts even now that images have an
 * exception.
 *
 * Imported dynamically because it touches `window` at module scope, which is a
 * crash rather than a warning when Next renders this on the server.
 */
export function SiteTileMap({
  sites,
  tileUrl,
  attribution,
  maxZoom,
  children,
}: {
  sites: readonly MappedSite[];
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | undefined>(undefined);
  const bounds = useRef<LatLngBounds | undefined>(undefined);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (sites.length === 0) return;
    let cancelled = false;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || !host.current || map.current) return;

      const instance = L.map(host.current, {
        // The keyboard needs to reach it, and a map that steals the page's
        // scroll as you pass over it is the most disliked thing on the web.
        keyboard: true,
        scrollWheelZoom: false,
        attributionControl: true,
      });

      L.tileLayer(tileUrl, { attribution, maxZoom, crossOrigin: true }).addTo(instance);

      const markers = sites.map((site) => {
        // Area with the dive count, so twice the dives is twice the ink rather
        // than four times — the same rule the SVG plot uses.
        const biggest = Math.max(...sites.map((s) => s.dives), 1);
        const marker = L.circleMarker([site.latitude, site.longitude], {
          radius: 6 + 8 * Math.sqrt(site.dives / biggest),
          className: 'site-marker',
        });
        marker.bindPopup(
          `<strong>${escapeHtml(site.name)}</strong><br>${site.dives} ${
            site.dives === 1 ? 'dive' : 'dives'
          }<br>${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}`,
        );
        return marker.addTo(instance);
      });

      // `pad` so a marker on the edge is not half outside the frame.
      bounds.current = L.featureGroup(markers).getBounds().pad(0.2);

      map.current = instance;
      setLive(true);
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = undefined;
    };
  }, [sites, tileUrl, attribution, maxZoom]);

  /*
   * Sized and framed only once it is on screen.
   *
   * Leaflet measures its container when the map is created, and this one is
   * `hidden` until there is something worth showing — so it measured zero,
   * asked for a single tile, and left the rest of the frame grey. Everything
   * that depends on the size has to wait for the element to have one: the
   * fit as much as the tile grid, or the zoom is computed for a box 0px wide.
   */
  useEffect(() => {
    if (!live || !map.current) return;
    map.current.invalidateSize();
    if (bounds.current) map.current.fitBounds(bounds.current, { maxZoom: 13 });
  }, [live]);

  return (
    <figure className="site-map-live" data-live={live ? 'true' : 'false'}>
      {/* Present from the first byte, and replaced only once a map has
          actually drawn. `hidden` rather than unmounted so nothing reflows. */}
      <div className="site-map-fallback" hidden={live}>
        {children}
      </div>

      <div
        ref={host}
        className="site-map-canvas"
        hidden={!live}
        role="application"
        aria-label={`Map of ${sites.length} dive ${sites.length === 1 ? 'site' : 'sites'}`}
      />

      {live && (
        <figcaption className="muted small">
          Tiles are fetched from {hostname(tileUrl)} as you pan, so that provider sees which parts
          of the world you are looking at. Your dives are never sent anywhere —{' '}
          <a href="/legal/privacy">what that means</a>.
        </figcaption>
      )}
    </figure>
  );
}

const hostname = (url: string): string => {
  try {
    return new URL(url.replace(/\{[^}]*\}/g, '1')).hostname;
  } catch {
    return 'the tile provider';
  }
};

/** A site name is diver-supplied text going into a popup's innerHTML. */
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
