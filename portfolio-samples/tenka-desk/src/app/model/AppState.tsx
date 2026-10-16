/**
 * App state: the user's files, settings and 協議記録, saved in this browser
 * (IndexedDB) and restored on the next visit. Heavy work (reading files and
 * the diagnosis) runs when the files change; the proposal and the simulation
 * are recomputed from the settings.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  appendEvent,
  type Company,
  type IsoDate,
  NegotiationError,
  type NegotiationEventDraft,
  type NegotiationLog,
  type SimulationResult,
  simulatePassThrough,
} from '../../engine/index.ts';
import { href } from '../router.ts';
import { fetchSampleFiles, type SampleLayout, sampleFileNames } from '../sample.ts';
import { clearAllStorage, idbGet, idbSet, onClearedElsewhere } from '../storage.ts';
import { buildLoaded, type ColumnChoice, type Loaded, type SourceFile } from './load.ts';
import { acceptanceFromLogs, logOf } from './negotiation.ts';
import { computeProposal, type ProposalResult } from './proposal.ts';
import { type AppSettings, defaultSettings, restoreSettings, toBp } from './settings.ts';

export type InputsState =
  | { source: 'sample'; layout: SampleLayout }
  | { source: 'upload'; files: SourceFile[] }
  | null;

export interface FollowupInputs {
  /** which price master to check against: the one built on the 書き出し screen, or a file */
  masterSource: 'built' | 'file';
  masterFile: SourceFile | null;
  salesFile: SourceFile | null;
}

const NO_FOLLOWUP: FollowupInputs = { masterSource: 'built', masterFile: null, salesFile: null };

/**
 * 協議記録・交渉結果ファイル・反映チェックの入力は、サンプル（架空）と自社データで別々に保存する。
 * 共有すると、サンプルで記録した「合意」が同じ得意先コード（例: 001001）の実在の得意先に付いて
 * 書き出しに入ったり、自社の記録がサンプルを試しただけで消えたりする。
 */
type Scope = 'sample' | 'upload';
const SCOPED_KEYS = ['logs', 'followup', 'outcomes'] as const;
type ScopedKey = (typeof SCOPED_KEYS)[number];
const scopedKey = (key: ScopedKey, scope: Scope) => `${key}:${scope}`;

function normaliseFollowup(f: FollowupInputs | null | undefined): FollowupInputs {
  if (!f) return NO_FOLLOWUP;
  return { ...NO_FOLLOWUP, ...f, masterSource: f.masterSource ?? (f.masterFile ? 'file' : 'built') };
}

export interface AppContextValue {
  ready: boolean;
  busy: string | null;
  error: string | null;
  clearError: () => void;
  storageOk: boolean;
  inputs: InputsState;
  loaded: Loaded | null;
  settings: AppSettings;
  updateSettings: (fn: (s: AppSettings) => AppSettings) => void;
  /** the proposal is being recomputed after a settings change */
  computing: boolean;
  proposal: ProposalResult | null;
  simulation: SimulationResult | null;
  company: Company;
  logs: Readonly<Record<string, NegotiationLog>>;
  appendLog: (cust: string, draft: NegotiationEventDraft) => string | null;
  replaceLogs: (logs: Record<string, NegotiationLog>) => void;
  followup: FollowupInputs;
  setFollowup: (f: FollowupInputs) => void;
  outcomesFile: SourceFile | null;
  setOutcomesFile: (f: SourceFile | null) => void;
  loadSample: (layout: SampleLayout) => Promise<void>;
  addFiles: (files: SourceFile[]) => Promise<void>;
  removeFile: (name: string) => Promise<void>;
  setMapping: (name: string, mapping: ColumnChoice | null) => Promise<void>;
  setRevisionDate: (file: string, date: IsoDate) => Promise<void>;
  setDiagnosisFloor: (pct: number | null) => Promise<void>;
  clearAll: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppProvider がありません');
  return v;
}

const EMPTY_COMPANY: Company = {
  name: '',
  business: '',
  address: '',
  tel: '',
  representative: '',
  branches: [],
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  // 前回の保存内容を読み終えるまでは操作を受け付けない（読み込みの完了が、先に押されたサンプル読み込みを上書きしないように）
  const [busy, setBusy] = useState<string | null>('前回のデータを確認しています…');
  const [error, setError] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [inputs, setInputs] = useState<InputsState>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [logs, setLogs] = useState<Readonly<Record<string, NegotiationLog>>>({});
  const [followup, setFollowupState] = useState<FollowupInputs>(NO_FOLLOWUP);
  const [outcomesFile, setOutcomesFileState] = useState<SourceFile | null>(null);

  /** files currently loaded (sample files are kept in memory only) */
  const sourcesRef = useRef<SourceFile[]>([]);
  /** whose 協議記録 etc. are shown: the sample's or the user's (see Scope) */
  const scopeRef = useRef<Scope>('upload');
  /** resolves once what this browser saved last time has been restored; user actions wait for it */
  const restoredRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (restoredRef.current === null) {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    restoredRef.current = { promise, resolve };
  }
  const whenRestored = useCallback(() => restoredRef.current?.promise ?? Promise.resolve(), []);
  const buildSeq = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** set by clearAll: the reset settings must not be written back right after the database was deleted */
  const justCleared = useRef(false);

  const persist = useCallback((key: string, value: unknown) => {
    idbSet(key, value).catch(() => setStorageOk(false));
  }, []);

  const persistScoped = useCallback(
    (key: ScopedKey, value: unknown) => persist(scopedKey(key, scopeRef.current), value),
    [persist],
  );

  /** show the 協議記録 etc. saved for the other data source (the current ones stay saved under their own) */
  const switchScope = useCallback(async (next: Scope) => {
    if (scopeRef.current === next) return;
    scopeRef.current = next;
    let l: Record<string, NegotiationLog> | undefined;
    let f: FollowupInputs | undefined;
    let o: SourceFile | null | undefined;
    try {
      [l, f, o] = await Promise.all([
        idbGet<Record<string, NegotiationLog>>(scopedKey('logs', next)),
        idbGet<FollowupInputs>(scopedKey('followup', next)),
        idbGet<SourceFile | null>(scopedKey('outcomes', next)),
      ]);
    } catch {
      setStorageOk(false);
    }
    if (scopeRef.current !== next) return;
    setLogs(l ?? {});
    setFollowupState(normaliseFollowup(f));
    setOutcomesFileState(o ?? null);
  }, []);

  /** Read the files and diagnose; resolves to true when this build finished with a diagnosis. */
  const rebuild = useCallback(
    async (
      sources: SourceFile[],
      isSample: boolean,
      s: AppSettings = settingsRef.current,
    ): Promise<boolean> => {
      const seq = ++buildSeq.current;
      sourcesRef.current = sources;
      setError(null);
      if (sources.length === 0) {
        // 読み込み中に最後のファイルを外したとき: 古い読み込みは seq が古いので busy を消せない。ここで消す
        setLoaded(null);
        setBusy(null);
        return false;
      }
      setBusy('ファイルを読み込んでいます…');
      try {
        const result = await buildLoaded(sources, {
          revisionDates: s.revisionDates,
          diagnosisFloorPct: s.diagnosisFloorPct,
          isSample,
          onProgress: (m) => {
            if (seq === buildSeq.current) setBusy(m);
          },
        });
        if (seq === buildSeq.current) setLoaded(result);
        return seq === buildSeq.current && result.diagnosis !== null;
      } catch (e) {
        if (seq === buildSeq.current) {
          setLoaded(null);
          setError(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        if (seq === buildSeq.current) setBusy(null);
      }
    },
    [],
  );

  // restore what this browser saved last time
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let savedInputs: InputsState = null;
      let restored = defaultSettings();
      try {
        const [s, i] = await Promise.all([idbGet<unknown>('settings'), idbGet<InputsState>('inputs')]);
        if (cancelled) return;
        restored = restoreSettings(s);
        setSettings(restored);
        settingsRef.current = restored;
        savedInputs = i ?? null;
        const scope: Scope = savedInputs?.source ?? 'upload';
        scopeRef.current = scope;
        const [l, f, o] = await Promise.all([
          idbGet<Record<string, NegotiationLog>>(scopedKey('logs', scope)),
          idbGet<FollowupInputs>(scopedKey('followup', scope)),
          idbGet<SourceFile | null>(scopedKey('outcomes', scope)),
        ]);
        if (cancelled) return;
        if (l) setLogs(l);
        if (f) setFollowupState(normaliseFollowup(f));
        if (o) setOutcomesFileState(o);
      } catch {
        setStorageOk(false);
      }
      if (cancelled) return;
      setInputs(savedInputs);
      setReady(true);
      restoredRef.current?.resolve();
      if (!savedInputs) setBusy(null);
      if (savedInputs?.source === 'upload') await rebuild(savedInputs.files, false, restored);
      else if (savedInputs?.source === 'sample') {
        setBusy('サンプルデータ（架空）を読み込んでいます…');
        try {
          const files = await fetchSampleFiles(sampleFileNames(savedInputs.layout));
          await rebuild(files, true, restored);
        } catch (e) {
          setBusy(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rebuild]);

  // save settings (debounced: sliders change them often)
  useEffect(() => {
    if (!ready) return;
    if (justCleared.current) {
      justCleared.current = false;
      return;
    }
    const t = setTimeout(() => persist('settings', settings), 400);
    return () => clearTimeout(t);
  }, [settings, ready, persist]);

  const updateSettings = useCallback((fn: (s: AppSettings) => AppSettings) => {
    setSettings((s) => fn(s));
  }, []);

  const setInputsAndSave = useCallback(
    (next: InputsState) => {
      setInputs(next);
      persist('inputs', next);
    },
    [persist],
  );

  const loadSample = useCallback(
    async (layout: SampleLayout) => {
      await whenRestored();
      setError(null);
      setBusy('サンプルデータ（架空）を読み込んでいます…');
      try {
        const files = await fetchSampleFiles(sampleFileNames(layout));
        await switchScope('sample');
        setInputsAndSave({ source: 'sample', layout });
        const next = { ...settingsRef.current, company: null, overrides: {}, revisionDates: {} };
        setSettings(next);
        settingsRef.current = next;
        // the story goes on with the diagnosis (the screen moves its focus to the new heading)
        if (await rebuild(files, true, next)) window.location.hash = href('diagnosis');
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rebuild, setInputsAndSave, switchScope, whenRestored],
  );

  const addFiles = useCallback(
    async (files: SourceFile[]) => {
      await whenRestored();
      const current = inputs?.source === 'upload' ? inputs.files : [];
      const names = new Set(files.map((f) => f.name));
      const merged = [...current.filter((f) => !names.has(f.name)), ...files];
      await switchScope('upload');
      setInputsAndSave({ source: 'upload', files: merged });
      if (inputs?.source === 'sample') {
        const next = { ...settingsRef.current, company: null, overrides: {} };
        setSettings(next);
        settingsRef.current = next;
      }
      await rebuild(merged, false);
    },
    [inputs, rebuild, setInputsAndSave, switchScope, whenRestored],
  );

  const removeFile = useCallback(
    async (name: string) => {
      if (inputs?.source !== 'upload') return;
      const files = inputs.files.filter((f) => f.name !== name);
      setInputsAndSave(files.length > 0 ? { source: 'upload', files } : null);
      await rebuild(files, false);
    },
    [inputs, rebuild, setInputsAndSave],
  );

  const setMapping = useCallback(
    async (name: string, mapping: ColumnChoice | null) => {
      if (inputs?.source !== 'upload') return;
      const files = inputs.files.map((f) => {
        if (f.name !== name) return f;
        const { mapping: _old, ...rest } = f;
        return mapping ? { ...rest, mapping } : rest;
      });
      setInputsAndSave({ source: 'upload', files });
      await rebuild(files, false);
    },
    [inputs, rebuild, setInputsAndSave],
  );

  const setRevisionDate = useCallback(
    async (file: string, date: IsoDate) => {
      const next = {
        ...settingsRef.current,
        revisionDates: { ...settingsRef.current.revisionDates, [file]: date },
      };
      setSettings(next);
      settingsRef.current = next;
      await rebuild(sourcesRef.current, inputs?.source === 'sample', next);
    },
    [inputs, rebuild],
  );

  const setDiagnosisFloor = useCallback(
    async (pct: number | null) => {
      const next = { ...settingsRef.current, diagnosisFloorPct: pct };
      setSettings(next);
      settingsRef.current = next;
      await rebuild(sourcesRef.current, inputs?.source === 'sample', next);
    },
    [inputs, rebuild],
  );

  const appendLog = useCallback(
    (cust: string, draft: NegotiationEventDraft): string | null => {
      try {
        const next = appendEvent(logOf(logs, cust), draft);
        const all = { ...logs, [cust]: next };
        setLogs(all);
        persistScoped('logs', all);
        return null;
      } catch (e) {
        return e instanceof NegotiationError || e instanceof Error ? e.message : String(e);
      }
    },
    [logs, persistScoped],
  );

  const replaceLogs = useCallback(
    (next: Record<string, NegotiationLog>) => {
      setLogs(next);
      persistScoped('logs', next);
    },
    [persistScoped],
  );

  const setFollowup = useCallback(
    (f: FollowupInputs) => {
      setFollowupState(f);
      persistScoped('followup', f);
    },
    [persistScoped],
  );

  const setOutcomesFile = useCallback(
    (f: SourceFile | null) => {
      setOutcomesFileState(f);
      persistScoped('outcomes', f);
    },
    [persistScoped],
  );

  /** forget everything shown (after the stored data was erased, here or in another tab) */
  const resetInMemory = useCallback(() => {
    buildSeq.current++;
    justCleared.current = true;
    sourcesRef.current = [];
    scopeRef.current = 'upload';
    const d = defaultSettings();
    settingsRef.current = d;
    setSettings(d);
    setInputs(null);
    setLoaded(null);
    setLogs({});
    setFollowupState(NO_FOLLOWUP);
    setOutcomesFileState(null);
    setError(null);
    setBusy(null);
    setStorageOk(true);
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await clearAllStorage();
    } catch (e) {
      // not erased (e.g. still open in another tab): keep showing the data and say why
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    resetInMemory();
  }, [resetInMemory]);

  // another tab erased the data: this one must not keep showing (or saving) it
  useEffect(() => onClearedElsewhere(resetInMemory), [resetInMemory]);

  // the proposal follows the settings with a short delay, so sliders stay smooth
  const calcInput = useMemo(
    () => ({ scenario: settings.scenario, guard: settings.guard, overrides: settings.overrides }),
    [settings.scenario, settings.guard, settings.overrides],
  );
  const calc = useDebounced(calcInput, 250);
  const computing =
    calc.scenario !== settings.scenario ||
    calc.guard !== settings.guard ||
    calc.overrides !== settings.overrides;
  const proposal = useMemo(
    () => (loaded?.diagnosis ? computeProposal(loaded, calc.scenario, calc.guard, calc.overrides) : null),
    [loaded, calc],
  );
  const acceptancePct = calc.scenario.acceptancePct;
  const simulation = useMemo(() => {
    if (!proposal?.ok) return null;
    return simulatePassThrough(proposal.pairs, {
      acceptance: acceptanceFromLogs(logs),
      defaultAcceptance: { kind: 'share', shareBp: toBp(acceptancePct) },
    });
  }, [proposal, logs, acceptancePct]);

  const company = settings.company ?? loaded?.company ?? EMPTY_COMPANY;

  const value: AppContextValue = {
    ready,
    busy,
    error,
    clearError: () => setError(null),
    storageOk,
    inputs,
    loaded,
    settings,
    updateSettings,
    computing,
    proposal,
    simulation,
    company,
    logs,
    appendLog,
    replaceLogs,
    followup,
    setFollowup,
    outcomesFile,
    setOutcomesFile,
    loadSample,
    addFiles,
    removeFile,
    setMapping,
    setRevisionDate,
    setDiagnosisFloor,
    clearAll,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
