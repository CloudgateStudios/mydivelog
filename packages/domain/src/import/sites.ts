import { distanceM, isValidCoordinate } from './geo.ts';
import { nameSimilarity } from './similarity.ts';
import { slugify } from './taxonomy.ts';

/**
 * Site matching.
 *
 * Runs before dive matching, because a resolved site improves a dive's score.
 *
 * The seed UDDF created a fresh site record for every single dive, so sites
 * 200 m apart are the same reef recorded 96 times. Meanwhile the spreadsheet
 * has `Angel City` and no coordinates at all. Merging the two produces a site
 * that is both named and located — which is the value proposition, and also
 * how a shared site database gets seeded without anyone typing it in.
 */

export type ExistingSite = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  regionId?: string;
  /** Every spelling this site has been seen under. */
  aliases?: string[];
};

export type SiteObservation = {
  name?: string;
  lat?: number;
  lon?: number;
  regionHint?: string;
};

export const SITE_MATCH_RULES = ['coordinates', 'coordinates-and-name', 'name', 'alias'] as const;
export type SiteMatchRule = (typeof SITE_MATCH_RULES)[number];

export type SiteMatch = {
  siteId: string;
  rule: SiteMatchRule;
  detail: string;
};

/** Same spot: closer than the length of a boat's swing on its mooring. */
export const SAME_SITE_M = 50;
/** Same reef, different entry: needs a name to agree as well. */
export const NEARBY_SITE_M = 250;
export const NEARBY_NAME_SIMILARITY = 0.6;
/** Higher: a name with no coordinates behind it is the weakest evidence here. */
export const NAME_ONLY_SIMILARITY = 0.85;

/**
 * Finds the site an observation belongs to, or nothing.
 *
 * Deliberately ordered from most to least evidence. Coordinates alone settle
 * it only when they are very close; at reef scale a name has to agree too,
 * because two moorings 200 m apart genuinely are different sites when the
 * diver has named them differently.
 */
export function matchSite(
  observation: SiteObservation,
  candidates: readonly ExistingSite[],
): SiteMatch | undefined {
  const coords =
    observation.lat !== undefined && observation.lon !== undefined
      ? { lat: observation.lat, lon: observation.lon }
      : undefined;

  if (isValidCoordinate(coords)) {
    const located = candidates
      .map((site) => {
        const siteCoords =
          site.lat !== undefined && site.lon !== undefined
            ? { lat: site.lat, lon: site.lon }
            : undefined;
        return isValidCoordinate(siteCoords)
          ? { site, metres: distanceM(coords, siteCoords) }
          : undefined;
      })
      .filter((c): c is { site: ExistingSite; metres: number } => c !== undefined)
      .sort((a, b) => a.metres - b.metres);

    const nearest = located[0];
    if (nearest && nearest.metres <= SAME_SITE_M) {
      return {
        siteId: nearest.site.id,
        rule: 'coordinates',
        detail: `${Math.round(nearest.metres)} m from ${nearest.site.name}.`,
      };
    }

    if (observation.name !== undefined) {
      for (const { site, metres } of located) {
        if (metres > NEARBY_SITE_M) break;
        if (nameSimilarity(observation.name, site.name) > NEARBY_NAME_SIMILARITY) {
          return {
            siteId: site.id,
            rule: 'coordinates-and-name',
            detail: `${Math.round(metres)} m from ${site.name}, and the names agree.`,
          };
        }
      }
    }
  }

  if (observation.name === undefined) return undefined;
  const slug = slugify(observation.name);

  // Name matching is not region-scoped, and that is a known limit rather than
  // an oversight. `Blue Hole` exists in Belize, Egypt, Malta and Guam and they
  // are not the same hole — but `regionHint` arrives as free text from a
  // spreadsheet ("Bonaire") while a Site carries a Region id, and resolving
  // one to the other is its own piece of work.
  //
  // What contains the damage today is that callers pass only the diver's own
  // sites: two Blue Holes collide only if one person logged both without
  // coordinates on either. Coordinates, which the rules above prefer anyway,
  // separate them the moment either has them.
  // Similarity rather than slug equality. `1,000 Steps` and `1000 Steps`
  // slugify to `1-000-steps` and `1000-steps`, which are not equal — and that
  // pair is the exact case this rule exists for. The bar is high because a
  // name with no coordinates behind it is the weakest evidence here.
  const byName = candidates
    .map((site) => ({ site, similarity: nameSimilarity(observation.name as string, site.name) }))
    .filter((c) => c.similarity >= NAME_ONLY_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)[0];
  if (byName) {
    return {
      siteId: byName.site.id,
      rule: 'name',
      detail: `Name matches ${byName.site.name}.`,
    };
  }

  // `1,000 Steps`, `Thousand Steps` and `1000 Steps` are one place, and the
  // alias list is how that knowledge accumulates rather than being guessed at
  // every time.
  const byAlias = candidates.find((site) => site.aliases?.some((a) => slugify(a) === slug));
  if (byAlias) {
    return {
      siteId: byAlias.id,
      rule: 'alias',
      detail: `"${observation.name}" is a known alias of ${byAlias.name}.`,
    };
  }

  return undefined;
}

/**
 * Which coordinates a site should end up with, given what it has and what a
 * new observation asserts.
 *
 * A site with no coordinates gaining them is the whole point. A site that
 * already has them keeps them: the first fix is usually the diver's own GPS
 * at the surface, and later ones are averaged over whoever else logged there.
 */
export function siteCoordinateUpdate(
  existing: { lat?: number; lon?: number },
  observed: { lat?: number; lon?: number },
): { lat: number; lon: number } | undefined {
  const has = isValidCoordinate(
    existing.lat !== undefined && existing.lon !== undefined
      ? { lat: existing.lat, lon: existing.lon }
      : undefined,
  );
  if (has) return undefined;

  const coords =
    observed.lat !== undefined && observed.lon !== undefined
      ? { lat: observed.lat, lon: observed.lon }
      : undefined;
  return isValidCoordinate(coords) ? coords : undefined;
}
