/** The Google Maps bearing is clockwise from geographic true north.
 * On screen, geographic north moves in the opposite direction.
 * This function never reads device orientation or unpublished plot data.
 */
export function geoMapNorthRotation(headingDeg) {
  if (!Number.isFinite(headingDeg)) return null;
  const normalized = ((headingDeg % 360) + 360) % 360;
  return normalized === 0 ? 0 : -normalized;
}
