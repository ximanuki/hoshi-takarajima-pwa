import { TtlLruCache } from '../cache.js';
import { ChiriinError } from '../errors.js';
import { assertInJapan, formatDegrees } from '../geo.js';
import type { HttpClient } from '../http-client.js';

/**
 * 測量計算サイト API (https://vldb.gsi.go.jp/sokuchi/surveycalc/api_help.html).
 * Limited by GSI to 10 requests per 10 seconds per IP — see DEFAULT_HOST_POLICIES.
 */
export const SURVEY_BASE = 'https://vldb.gsi.go.jp/sokuchi/surveycalc';

export interface DistanceResult {
  /** Geodesic length on the GRS80 ellipsoid (m). */
  distanceM: number;
  /** Azimuth from point 1 towards point 2 (degrees clockwise from true north). */
  azimuthFromStartDeg: number;
  /** Azimuth from point 2 back towards point 1. */
  azimuthFromEndDeg: number;
}

export interface PlaneResult {
  zone: number;
  /** X (northing) in metres — Japanese survey convention: X is north. */
  x: number;
  /** Y (easting) in metres. */
  y: number;
  /** 真北方向角 (degrees). */
  gridConvergenceDeg: number;
  scaleFactor: number;
}

export interface LatLonResult {
  lat: number;
  lon: number;
  gridConvergenceDeg: number;
  scaleFactor: number;
}

export interface GeoidResult {
  /** ジオイド高（ジオイド2024日本とその周辺）(m). */
  geoidHeightM: number;
  /** 基準面補正量 (m): non-zero on some remote islands that keep their own height datum. */
  referenceCorrectionM: number;
  /** ジオイド高 + 基準面補正量 (m). 標高 = 楕円体高 − この値. */
  totalM: number;
}

function formatMeters(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function distanceUrl(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const p = new URLSearchParams({
    outputType: 'json',
    ellipsoid: 'GRS80',
    latitude1: formatDegrees(lat1),
    longitude1: formatDegrees(lon1),
    latitude2: formatDegrees(lat2),
    longitude2: formatDegrees(lon2),
  });
  return `${SURVEY_BASE}/surveycalc/bl2st_calc.pl?${p}`;
}

export function toPlaneUrl(lat: number, lon: number, zone: number): string {
  const p = new URLSearchParams({
    outputType: 'json',
    refFrame: '2',
    zone: String(zone),
    latitude: formatDegrees(lat),
    longitude: formatDegrees(lon),
  });
  return `${SURVEY_BASE}/surveycalc/bl2xy.pl?${p}`;
}

export function fromPlaneUrl(x: number, y: number, zone: number): string {
  const p = new URLSearchParams({
    outputType: 'json',
    refFrame: '2',
    zone: String(zone),
    publicX: formatMeters(x),
    publicY: formatMeters(y),
  });
  return `${SURVEY_BASE}/surveycalc/xy2bl.pl?${p}`;
}

export function geoidUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    outputType: 'json',
    latitude: formatDegrees(lat),
    longitude: formatDegrees(lon),
  });
  return `${SURVEY_BASE}/geoid/calcgh/cgi/geoidcalc.pl?${p}`;
}

/** Extracts OutputData, or converts GSI's {"ExportData":{"ErrMsg": "..."}} into a bilingual error. */
export function unwrapSurveyResponse(json: unknown): Record<string, unknown> {
  const body = (typeof json === 'object' && json !== null ? json : {}) as {
    OutputData?: Record<string, unknown>;
    ExportData?: { ErrMsg?: unknown };
  };
  if (body.OutputData && typeof body.OutputData === 'object') return body.OutputData;
  const message = typeof body.ExportData?.ErrMsg === 'string' ? body.ExportData.ErrMsg : undefined;
  if (message) {
    const cleaned = message
      .split(/(?=\d{3}:)/)
      .map((m) => m.replace(/^\d{3}:/, '').trim())
      .filter(Boolean)
      .join(' ');
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `測量計算サイトが入力を受け付けませんでした: ${cleaned}`,
      en: `GSI survey calculation rejected the input: ${cleaned}`,
    });
  }
  throw new ChiriinError({
    code: 'UPSTREAM_BAD_RESPONSE',
    ja: '測量計算サイトの応答形式が想定と異なります',
    en: 'Unexpected response format from the GSI survey calculation API',
  });
}

function num(data: Record<string, unknown>, key: string, emptyAs?: number): number {
  const raw = data[key];
  if (raw === '' && emptyAs !== undefined) return emptyAs;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
    throw new ChiriinError({
      code: 'UPSTREAM_BAD_RESPONSE',
      ja: `測量計算サイトの応答に ${key} がありません`,
      en: `The GSI survey calculation response lacks a numeric "${key}"`,
    });
  }
  return value;
}

export function assertZone(zone: number): void {
  if (!Number.isInteger(zone) || zone < 1 || zone > 19) {
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `平面直角座標系の系番号 ${zone} は不正です（1〜19）`,
      en: `Invalid plane rectangular coordinate zone ${zone} (must be 1–19)`,
    });
  }
}

export class SurveyCalcService {
  constructor(
    private readonly http: HttpClient,
    private readonly cache = new TtlLruCache<Record<string, unknown>>(512, 24 * 60 * 60 * 1000),
  ) {}

  private async call(url: string): Promise<Record<string, unknown>> {
    return this.cache.getOrLoad(url, async () => unwrapSurveyResponse(await this.http.getJson(url)));
  }

  async distance(lat1: number, lon1: number, lat2: number, lon2: number): Promise<DistanceResult> {
    assertInJapan(lat1, lon1, '出発点');
    assertInJapan(lat2, lon2, '到着点');
    const data = await this.call(distanceUrl(lat1, lon1, lat2, lon2));
    // GSI returns an empty geoLength when both points coincide.
    return {
      distanceM: num(data, 'geoLength', 0),
      azimuthFromStartDeg: num(data, 'azimuth1', 0),
      azimuthFromEndDeg: num(data, 'azimuth2', 0),
    };
  }

  async toPlane(lat: number, lon: number, zone: number): Promise<PlaneResult> {
    assertInJapan(lat, lon);
    assertZone(zone);
    const data = await this.call(toPlaneUrl(lat, lon, zone));
    return {
      zone,
      x: num(data, 'publicX'),
      y: num(data, 'publicY'),
      gridConvergenceDeg: num(data, 'gridConv'),
      scaleFactor: num(data, 'scaleFactor'),
    };
  }

  async fromPlane(x: number, y: number, zone: number): Promise<LatLonResult> {
    assertZone(zone);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 2_000_000 || Math.abs(y) > 2_000_000) {
      throw new ChiriinError({
        code: 'OUT_OF_RANGE',
        ja: `X=${x}, Y=${y} は平面直角座標として大きすぎます（±2,000km 以内）`,
        en: `X=${x}, Y=${y} is out of range for plane rectangular coordinates (within ±2,000 km)`,
      });
    }
    const data = await this.call(fromPlaneUrl(x, y, zone));
    return {
      lat: num(data, 'latitude'),
      lon: num(data, 'longitude'),
      gridConvergenceDeg: num(data, 'gridConv'),
      scaleFactor: num(data, 'scaleFactor'),
    };
  }

  async geoid(lat: number, lon: number): Promise<GeoidResult> {
    assertInJapan(lat, lon);
    const data = await this.call(geoidUrl(lat, lon));
    const geoidHeightM = num(data, 'geoidHeight');
    const referenceCorrectionM =
      data.HeightReferenceConversion === undefined ? 0 : num(data, 'HeightReferenceConversion');
    const total = data['geoidHeight+HeightReferenceConversion'];
    return {
      geoidHeightM,
      referenceCorrectionM,
      totalM:
        total === undefined
          ? geoidHeightM + referenceCorrectionM
          : num(data, 'geoidHeight+HeightReferenceConversion'),
    };
  }
}
