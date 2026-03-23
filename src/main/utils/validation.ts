/**
 * Validates that lat/lon values are valid geographic coordinates.
 * Accepts any type and coerces to number for runtime safety.
 */
export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  if (lat == null || lon == null) return false;
  const nLat = Number(lat);
  const nLon = Number(lon);
  return (
    !Number.isNaN(nLat) &&
    !Number.isNaN(nLon) &&
    nLat >= -90 &&
    nLat <= 90 &&
    nLon >= -180 &&
    nLon <= 180
  );
}
