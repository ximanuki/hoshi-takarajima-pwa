/** Web-Mercator tile math (地理院タイル / ハザードマップタイルの仕様). */
export const TILE_SIZE = 256;
const MAX_MERCATOR_LAT = 85.05112878;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export interface TilePosition {
  z: number;
  /** Tile column. */
  x: number;
  /** Tile row. */
  y: number;
  /** Pixel inside the tile (0..255). */
  px: number;
  py: number;
}

export function latLonToTile(lat: number, lon: number, z: number): TilePosition {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const scale = TILE_SIZE * 2 ** z;
  const gx = ((lon + 180) / 360) * scale;
  const rad = (clampedLat * Math.PI) / 180;
  const gy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  const x = Math.floor(gx / TILE_SIZE);
  const y = Math.floor(gy / TILE_SIZE);
  return { z, x, y, px: Math.floor(gx - x * TILE_SIZE), py: Math.floor(gy - y * TILE_SIZE) };
}

/** Lat/lon of the centre of a pixel (inverse of latLonToTile). */
export function tilePixelToLatLon(pos: TilePosition): { lat: number; lon: number } {
  const scale = TILE_SIZE * 2 ** pos.z;
  const gx = pos.x * TILE_SIZE + pos.px + 0.5;
  const gy = pos.y * TILE_SIZE + pos.py + 0.5;
  const lon = (gx / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * gy) / scale;
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lat, lon };
}

/** Ground size of one pixel in metres at the given latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}
