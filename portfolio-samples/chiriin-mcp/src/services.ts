import { ElevationService } from './api/elevation.js';
import { GeocodeService } from './api/geocode.js';
import { HazardService } from './api/hazard.js';
import { SurveyCalcService } from './api/surveycalc.js';
import type { Clock } from './clock.js';
import type { Config } from './config.js';
import { type FetchLike, type HostPolicy, HttpClient } from './http-client.js';

/** Everything the tools need; one instance is shared by all MCP sessions of a process. */
export interface Services {
  geocoder: GeocodeService;
  elevation: ElevationService;
  survey: SurveyCalcService;
  hazard: HazardService;
  now: () => Date;
}

export interface ServiceOptions {
  config: Config;
  fetch?: FetchLike;
  clock?: Clock;
  policies?: Readonly<Record<string, HostPolicy>>;
  now?: () => Date;
}

export function createServices(options: ServiceOptions): Services {
  const http = new HttpClient({
    timeoutMs: options.config.timeoutMs,
    retries: options.config.retries,
    userAgent: options.config.userAgent,
    maxResponseBytes: options.config.maxResponseBytes,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.policies ? { policies: options.policies } : {}),
  });
  return {
    geocoder: new GeocodeService(http),
    elevation: new ElevationService(http),
    survey: new SurveyCalcService(http),
    hazard: new HazardService(http),
    now: options.now ?? (() => new Date()),
  };
}
