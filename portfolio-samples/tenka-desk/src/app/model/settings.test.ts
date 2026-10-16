/**
 * 手入力の単価・改定日・差出人の会社情報 belong to the data they were made for: trying the sample (架空)
 * must neither show the user's values on the sample nor erase them. The browser storage is a Map here,
 * saved and switched the way the app does it (shared settings once, the data's own per data source).
 */

import { describe, expect, it } from 'vitest';
import type { Company } from '../../engine/index.ts';
import {
  type AppSettings,
  dataSettingsOf,
  defaultSettings,
  restoreSettingsFor,
  sharedSettingsOf,
  withDataSettings,
} from './settings.ts';

const OWN_COMPANY: Company = {
  name: '自社テスト株式会社',
  business: '',
  address: '大阪府大阪市',
  tel: '06-0000-0000',
  representative: '代表 太郎',
  branches: [],
};

type Scope = 'sample' | 'upload';

function browser() {
  const kv = new Map<string, unknown>();
  return {
    kv,
    save(s: AppSettings, scope: Scope) {
      kv.set('settings', structuredClone(sharedSettingsOf(s)));
      kv.set(`settings:${scope}`, structuredClone(dataSettingsOf(s)));
    },
    switchTo(s: AppSettings, scope: Scope): AppSettings {
      return withDataSettings(s, kv.get(`settings:${scope}`));
    },
    reload(scope: Scope): AppSettings {
      return restoreSettingsFor(kv.get('settings'), kv.get(`settings:${scope}`));
    },
  };
}

describe('settings per data source', () => {
  const own: AppSettings = {
    ...defaultSettings(),
    overrides: { '001001|DB-1001': 4236 },
    revisionDates: { 'agreements_2026-04.csv': '2026-04-01' },
    company: OWN_COMPANY,
  };
  own.scenario.passThroughPct = 80;

  it('own data → sample → own data keeps the manual prices, 改定日 and company', () => {
    const b = browser();
    b.save(own, 'upload');

    // the sample starts from its own empty values; the scenario is shared
    let s = b.switchTo(own, 'sample');
    expect(s.overrides).toEqual({});
    expect(s.revisionDates).toEqual({});
    expect(s.company).toBeNull();
    expect(s.scenario.passThroughPct).toBe(80);
    s = { ...s, overrides: { '001001|DB-1001': 999 } };
    b.save(s, 'sample');

    // the user's values are still saved, and come back with the user's data
    s = b.switchTo(s, 'upload');
    expect(s.overrides).toEqual({ '001001|DB-1001': 4236 });
    expect(s.revisionDates).toEqual({ 'agreements_2026-04.csv': '2026-04-01' });
    expect(s.company).toEqual(OWN_COMPANY);
    // and the sample keeps its own
    expect(b.switchTo(s, 'sample').overrides).toEqual({ '001001|DB-1001': 999 });
  });

  it('a reload restores the values of the data that was open', () => {
    const b = browser();
    b.save(own, 'upload');
    b.save({ ...b.switchTo(own, 'sample'), overrides: { 'X|Y': 1 } }, 'sample');

    expect(b.reload('sample').overrides).toEqual({ 'X|Y': 1 });
    expect(b.reload('sample').company).toBeNull();
    const back = b.reload('upload');
    expect(dataSettingsOf(back)).toEqual(dataSettingsOf(own));
    expect(back.scenario.passThroughPct).toBe(80);
  });

  it('never saves one data source’s values with the shared settings', () => {
    const shared = sharedSettingsOf(own) as Partial<AppSettings>;
    expect(shared.overrides).toBeUndefined();
    expect(shared.revisionDates).toBeUndefined();
    expect(shared.company).toBeUndefined();
    expect(shared.scenario?.passThroughPct).toBe(80);
  });

  it('keeps the values an older version saved with the shared settings for the data then open', () => {
    const legacy = structuredClone(own);
    expect(dataSettingsOf(restoreSettingsFor(legacy, undefined))).toEqual(dataSettingsOf(own));
    // once the data has values of its own, those count
    expect(restoreSettingsFor(legacy, { overrides: {} }).overrides).toEqual({});
  });
});
