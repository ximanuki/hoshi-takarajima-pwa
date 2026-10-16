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
  type NegotiationEventDraft,
  type NegotiationLog,
  NegotiationError,
  type SimulationResult,
  simulatePassThrough,
} from '../../engine/index.ts';
import { fetchSampleFiles, type SampleLayout, sampleFileNames } from '../sample.ts';
import { clearAllStorage, idbGet, idbSet } from '../storage.ts';
import { buildLoaded, type ColumnChoice, type Loaded, type SourceFile } from './load.ts';
import { acceptanceFromLogs, logOf } from './negotiation.ts';
import { computeProposal, type ProposalResult } from './proposal.ts';
import { type AppSettings, defaultSettings, restoreSettings, toBp } from './settings.ts';

export type InputsState =
  | { source: 'sample'; layout: SampleLayout }
  | { source: 'upload'; files: SourceFile[] }
  | null;

export interface FollowupInputs {
  /** null = use the price master built on the 書き出し screen */
  masterFile: SourceFile | null;
  salesFile: SourceFile | null;
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

const EMPTY_COMPANY: Company = { name: '', business: '', address: '', tel: '', representative: '', branches: [] };

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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [inputs, setInputs] = useState<InputsState>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [logs, setLogs] = useState<Readonly<Record<string, NegotiationLog>>>({});
  const [followup, setFollowupState] = useState<FollowupInputs>({ masterFile: null, salesFile: null });
  const [outcomesFile, setOutcomesFileState] = useState<SourceFile | null>(null);

  /** files currently loaded (sample files are kept in memory only) */
  const sourcesRef = useRef<SourceFile[]>([]);
  const buildSeq = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const persist = useCallback((key: string, value: unknown) => {
    idbSet(key, value).catch(() => setStorageOk(false));
  }, []);

  const rebuild = useCallback(
    async (sources: SourceFile[], isSample: boolean, s: AppSettings = settingsRef.current) => {
      const seq = ++buildSeq.current;
      sourcesRef.current = sources;
      setError(null);
      if (sources.length === 0) {
        setLoaded(null);
        return;
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
      } catch (e) {
        if (seq === buildSeq.current) {
          setLoaded(null);
          setError(e instanceof Error ? e.message : String(e));
        }
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
        const [s, i, l, f, o] = await Promise.all([
          idbGet<unknown>('settings'),
          idbGet<InputsState>('inputs'),
          idbGet<Record<string, NegotiationLog>>('logs'),
          idbGet<FollowupInputs>('followup'),
          idbGet<SourceFile | null>('outcomes'),
        ]);
        if (cancelled) return;
        restored = restoreSettings(s);
        setSettings(restored);
        settingsRef.current = restored;
        if (l) setLogs(l);
        if (f) setFollowupState(f);
        if (o) setOutcomesFileState(o);
        savedInputs = i ?? null;
      } catch {
        setStorageOk(false);
      }
      if (cancelled) return;
      setInputs(savedInputs);
      setReady(true);
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
      setError(null);
      setBusy('サンプルデータ（架空）を読み込んでいます…');
      try {
        const files = await fetchSampleFiles(sampleFileNames(layout));
        setInputsAndSave({ source: 'sample', layout });
        const next = { ...settingsRef.current, company: null, overrides: {}, revisionDates: {} };
        setSettings(next);
        settingsRef.current = next;
        await rebuild(files, true, next);
      } catch (e) {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [rebuild, setInputsAndSave],
  );

  const addFiles = useCallback(
    async (files: SourceFile[]) => {
      const current = inputs?.source === 'upload' ? inputs.files : [];
      const names = new Set(files.map((f) => f.name));
      const merged = [...current.filter((f) => !names.has(f.name)), ...files];
      setInputsAndSave({ source: 'upload', files: merged });
      if (inputs?.source === 'sample') {
        const next = { ...settingsRef.current, company: null, overrides: {} };
        setSettings(next);
        settingsRef.current = next;
      }
      await rebuild(merged, false);
    },
    [inputs, rebuild, setInputsAndSave],
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
      const next = { ...settingsRef.current, revisionDates: { ...settingsRef.current.revisionDates, [file]: date } };
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
        persist('logs', all);
        return null;
      } catch (e) {
        return e instanceof NegotiationError || e instanceof Error ? e.message : String(e);
      }
    },
    [logs, persist],
  );

  const replaceLogs = useCallback(
    (next: Record<string, NegotiationLog>) => {
      setLogs(next);
      persist('logs', next);
    },
    [persist],
  );

  const setFollowup = useCallback(
    (f: FollowupInputs) => {
      setFollowupState(f);
      persist('followup', f);
    },
    [persist],
  );

  const setOutcomesFile = useCallback(
    (f: SourceFile | null) => {
      setOutcomesFileState(f);
      persist('outcomes', f);
    },
    [persist],
  );

  const clearAll = useCallback(async () => {
    buildSeq.current++;
    await clearAllStorage();
    sourcesRef.current = [];
    const d = defaultSettings();
    settingsRef.current = d;
    setSettings(d);
    setInputs(null);
    setLoaded(null);
    setLogs({});
    setFollowupState({ masterFile: null, salesFile: null });
    setOutcomesFileState(null);
    setError(null);
    setBusy(null);
    setStorageOk(true);
  }, []);

  // the proposal follows the settings with a short delay, so sliders stay smooth
  const calcInput = useMemo(
    () => ({ scenario: settings.scenario, guard: settings.guard, overrides: settings.overrides }),
    [settings.scenario, settings.guard, settings.overrides],
  );
  const calc = useDebounced(calcInput, 250);
  const computing =
    calc.scenario !== settings.scenario || calc.guard !== settings.guard || calc.overrides !== settings.overrides;
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
