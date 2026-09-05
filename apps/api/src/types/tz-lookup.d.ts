/**
 * `tz-lookup` ships no types and has no @types package.
 *
 * The whole surface is one function, so declaring it here is smaller than any
 * alternative and documents what it actually throws — which the resolver
 * depends on catching.
 */
declare module 'tz-lookup' {
  /**
   * IANA zone name for a coordinate, e.g. `America/Curacao`.
   * Throws a RangeError for coordinates outside the world's bounds.
   */
  export default function tzLookup(latitude: number, longitude: number): string;
}
