/**
 * Unit tests for the pure projection math exported from OfflineMapCanvas.
 *
 * No native deps — just numeric arithmetic, suitable for Jest without mocks.
 */
import { projectLatLon, computeScale } from '../components/OfflineMapCanvas';

const METERS_PER_DEG_LAT = 111_320;

// Reference canvas: 400 × 800, user at 35% from top
const CANVAS_W = 400;
const CANVAS_H = 800;
const CENTER_X = CANVAS_W / 2;   // 200
const CENTER_Y = CANVAS_H * 0.35; // 280

const GPS_LAT = 37.4219983;  // Googleplex
const GPS_LON = -122.0839998;

const RADIUS_METERS = 1_000; // 1 km

const scale = computeScale(CANVAS_W, CANVAS_H, CENTER_X, CENTER_Y, RADIUS_METERS);

describe('OfflineMapCanvas — projection math', () => {
  it('POI at user location → screen position equals centre', () => {
    const { x, y } = projectLatLon(
      GPS_LAT, GPS_LON,
      GPS_LAT, GPS_LON,
      CENTER_X, CENTER_Y, scale,
    );
    expect(x).toBeCloseTo(CENTER_X, 5);
    expect(y).toBeCloseTo(CENTER_Y, 5);
  });

  it('POI 1 km north → screen y is centre - (1000 × scale), x unchanged', () => {
    const dLat = 1000 / METERS_PER_DEG_LAT;
    const { x, y } = projectLatLon(
      GPS_LAT + dLat, GPS_LON,
      GPS_LAT, GPS_LON,
      CENTER_X, CENTER_Y, scale,
    );
    expect(x).toBeCloseTo(CENTER_X, 3);
    expect(y).toBeCloseTo(CENTER_Y - 1000 * scale, 3);
  });

  it('POI 1 km east → screen x is centre + (1000 × scale), y unchanged', () => {
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((GPS_LAT * Math.PI) / 180);
    const dLon = 1000 / metersPerDegLon;
    const { x, y } = projectLatLon(
      GPS_LAT, GPS_LON + dLon,
      GPS_LAT, GPS_LON,
      CENTER_X, CENTER_Y, scale,
    );
    expect(y).toBeCloseTo(CENTER_Y, 3);
    expect(x).toBeCloseTo(CENTER_X + 1000 * scale, 3);
  });

  it('POI 1 km NE → both axes shifted independently (no diagonal-vs-cardinal scale bug)', () => {
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((GPS_LAT * Math.PI) / 180);
    const dLat = 1000 / METERS_PER_DEG_LAT;
    const dLon = 1000 / metersPerDegLon;
    const { x, y } = projectLatLon(
      GPS_LAT + dLat, GPS_LON + dLon,
      GPS_LAT, GPS_LON,
      CENTER_X, CENTER_Y, scale,
    );
    // x shifted east by 1 km
    expect(x).toBeCloseTo(CENTER_X + 1000 * scale, 3);
    // y shifted north by 1 km
    expect(y).toBeCloseTo(CENTER_Y - 1000 * scale, 3);
  });

  it('POI due south → y is greater than centre (south = down)', () => {
    const dLat = 500 / METERS_PER_DEG_LAT;
    const { y } = projectLatLon(
      GPS_LAT - dLat, GPS_LON,
      GPS_LAT, GPS_LON,
      CENTER_X, CENTER_Y, scale,
    );
    expect(y).toBeGreaterThan(CENTER_Y);
    expect(y).toBeCloseTo(CENTER_Y + 500 * scale, 3);
  });

  it('computeScale: radius circle radius in pixels equals radiusMeters * scale', () => {
    const radiusPx = RADIUS_METERS * scale;
    // With radiusMeters=1000, halfAxis = min(200, 280, 520) = 200
    // scale = (200 * 0.9) / 1000 = 0.18
    // radiusPx = 1000 * 0.18 = 180
    expect(radiusPx).toBeCloseTo(180, 5);
  });
});
