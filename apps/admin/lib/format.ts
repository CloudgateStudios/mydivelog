/** Display helpers. Everything is stored in SI; nothing here converts it. */

export const dateTime = (value: Date | string | null | undefined): string => {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

export const date = (value: Date | string | null | undefined): string =>
  value ? dateTime(value).slice(0, 10) : '—';

export const metres = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)} m`;

export const minutes = (seconds: number | null | undefined): string =>
  seconds === null || seconds === undefined ? '—' : `${Math.round(seconds / 60)} min`;

export const celsius = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(1)} °C`;

export const kilograms = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(2)} kg`;

/** `-240` → `-04:00`. The offset is the point, so it is never hidden. */
export const offset = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

export const coordinates = (lat: number | null, lon: number | null): string =>
  lat === null || lon === null ? '—' : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

export const shortId = (id: string): string => id.slice(0, 8);

export const bytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * Renders a provenance value.
 *
 * Dates are stored with an `@date:` prefix so they survive the JSON column,
 * which is an implementation detail of the storage and not something a person
 * reading a provenance table should have to decode.
 */
export const provenanceValue = (value: unknown): string => {
  if (typeof value === 'string' && value.startsWith('@date:')) {
    return dateTime(value.slice(6));
  }
  const text = JSON.stringify(value);
  if (text === undefined) return '—';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
};
