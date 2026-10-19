import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnosis.ts';
import { encodeShiftJis } from './encoding.ts';
import { importFile, LayoutNotRecognisedError } from './importers.ts';
import { layoutById } from './layouts.ts';
import { AGREEMENTS_HEADER, type TwoRevisionOptions, twoRevisionFiles } from './testing/twoRevisions.ts';
import {
  companyFromJson,
  loadWorkspace,
  previousRevisionDateFromJson,
  settingsFromJson,
  type WorkspaceOptions,
  workspaceFromImports,
  yearMonthsInName,
} from './workspace.ts';

const files = {
  customers:
    '得意先コード,得意先名,略称,取引先区分,掛率ランク,掛率(%),担当営業所,営業担当,都道府県,締日,宛先部署,取引開始日\n000001,株式会社A商事,(株)A商事,製造業,B,72.0,本社営業部,佐藤,大阪府,末日,購買部,2015-04-01\n',
  products:
    '商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)\nDB-1001,段ボール箱,DB,ケース,770,311.41,S01,,,,\n',
  categories:
    'カテゴリコード,カテゴリ名,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%),主な原材料\nDB,段ボール・紙器,55,15,15,15,段ボール原紙\n',
  tiers: '掛率ランク,名称,標準掛率(%),下限(%),上限(%),説明\nB,一般,72.0,70.0,75.0,\n',
  history: `商品コード,定価(円),適用開始日,適用終了日\n${Array.from({ length: 12 }, (_, i) => `DB-10${String(i).padStart(2, '0')},700,2024-04-01,2025-03-31\nDB-10${String(i).padStart(2, '0')},770,2025-04-01,`).join('\n')}\n`,
  agreements:
    '得意先コード,得意先名,申入日,回答日,合意状況,適用日,対象外カテゴリ,備考\n000001,株式会社A商事,2025-01-15,2025-02-20,見送り,,,\n',
  sales: '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価\n20250501,1,1,1,db1001,5,504\n',
};

describe('loadWorkspace', () => {
  it('detects every file, assigns the agreements to the 定価改定 found in the history, and resolves codes', () => {
    const ws = loadWorkspace([
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: encodeShiftJis(files.products) },
      { name: 'categories.csv', data: files.categories },
      { name: 'tiers.csv', data: files.tiers },
      { name: 'history.csv', data: files.history },
      { name: 'agreements.csv', data: files.agreements },
      { name: 'sales.csv', data: files.sales },
    ]);
    expect(ws.files.map((f) => f.spec.id)).toEqual([
      'customers',
      'products',
      'categories',
      'rateTiers',
      'listPriceHistory',
      'agreements',
      'sales-B',
    ]);
    expect(ws.files[1]?.decoded.encoding).toBe('shift_jis');
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-04-01']);
    expect(ws.notes[0]).toContain('令和7年4月1日');
    expect(ws.sales.get('sales.csv')?.[0]?.sku).toBe('DB-1001');
    // the product has no cost split of its own: the category's is used
    expect(ws.dataset.costShareOf('DB-1001')).toEqual({ material: 55, labor: 15, energy: 15, other: 15 });
    // 見送り: the old 定価 still applies
    expect(ws.dataset.expectedPrice('000001', 'DB-1001', '2025-05-01')?.price).toBe(504);
    // the history mentions products that are not in the master
    expect(ws.dataset.issues.some((i) => i.kind === 'unknown_product')).toBe(true);
  });

  it('leaves an agreements file out when its revision is unclear, unless a date is given', () => {
    const inputs = [
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: files.products },
      { name: 'tiers.csv', data: files.tiers },
      { name: 'a1.csv', data: files.agreements },
      { name: 'a2.csv', data: files.agreements },
    ];
    const ws = loadWorkspace(inputs);
    expect(ws.dataset.revisions).toEqual([]);
    // a warning, not an info note
    expect(ws.notes.filter((n) => n.includes('使っていません'))).toEqual([]);
    expect(ws.warnings.filter((n) => n.includes('使っていません'))).toHaveLength(2);
    expect(ws.agreementFiles.map((a) => [a.file, a.used])).toEqual([
      ['a1.csv', false],
      ['a2.csv', false],
    ]);
    const ws2 = loadWorkspace(inputs, { revisionDates: { 'a1.csv': '2025-04-01' } });
    expect(ws2.dataset.revisions.map((r) => r.date)).toEqual(['2025-04-01']);
    expect(ws2.agreementFiles[0]).toMatchObject({ file: 'a1.csv', date: '2025-04-01', source: 'entered' });
  });

  it('collects import problems by file', () => {
    const ws = loadWorkspace([
      {
        name: 'sales.csv',
        data: '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価\n2025xx01,1,1,1,DB-1001,5,504\n',
      },
    ]);
    expect(ws.importIssues).toHaveLength(1);
    expect(ws.importIssues[0]?.file).toBe('sales.csv');
  });
});

function loadTwo(options: TwoRevisionOptions = {}, wsOptions: WorkspaceOptions = {}) {
  const ws = loadWorkspace(
    twoRevisionFiles(options).map((f) => ({ name: f.name, data: f.text })),
    wsOptions,
  );
  const total = diagnose(ws.dataset, ws.sales.get('sales.csv') ?? []).summary.reduce(
    (s, x) => s + x.annualImpactYen,
    0,
  );
  return { ws, total };
}

describe('which revision an agreements file answers', () => {
  it('leaves the file out, with a warning, when the history has two revisions and nothing points to one', () => {
    const { ws, total } = loadTwo();
    expect(ws.revisionCandidates).toEqual(['2025-04-01', '2025-10-01']);
    expect(ws.dataset.revisions).toEqual([]);
    expect(ws.agreementFiles).toEqual([
      expect.objectContaining({ file: 'agreements.csv', date: null, source: null, used: false }),
    ]);
    expect(ws.warnings).toHaveLength(1);
    expect(ws.warnings[0]).toContain('使っていません');
    expect(ws.warnings[0]).toContain('反映漏れと掛率ランク外が多めに出ます');
    expect(ws.warnings[0]).toContain('令和7年4月1日');
    expect(ws.warnings[0]).toContain('令和7年10月1日');
    // the declined customer's correct old prices are counted as 反映漏れ
    expect(total).toBe(1800);
  });

  it('uses the year and month in the file name when exactly one revision matches', () => {
    const { ws, total } = loadTwo({ agreementsName: 'revision_2025-10_agreements.csv' });
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
    expect(ws.agreementFiles[0]).toMatchObject({
      date: '2025-10-01',
      source: 'inferred',
      signals: ['file_name'],
      inHistory: true,
      used: true,
    });
    const note = ws.notes.find((n) => n.includes('revision_2025-10_agreements.csv'));
    expect(note).toContain('令和7年10月1日');
    expect(note).toContain('ファイル名');
    expect(ws.warnings).toEqual([]);
    expect(total).toBe(720);
  });

  it('uses the most common 適用日 of the file, but not when two dates tie', () => {
    const one = loadTwo({ agreedEffective: '2025-10-01' });
    expect(one.ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
    expect(one.ws.agreementFiles[0]).toMatchObject({ source: 'inferred', signals: ['effective_dates'] });
    expect(one.total).toBe(720);

    const tie = loadTwo({
      agreementRows: [
        '000001,株式会社甲見本商事（架空）,2025-07-01,2025-08-01,合意,2025-10-01,,',
        '000002,乙見本工業株式会社（架空）,2025-07-01,2025-08-01,合意(適用日変更),2025-11-01,,',
      ],
    });
    expect(tie.ws.dataset.revisions).toEqual([]);
    expect(tie.ws.agreementFiles[0]).toMatchObject({ used: false, signals: [] });
  });

  it('uses previousRevisionDate from the settings only when there is one agreements file', () => {
    const { ws, total } = loadTwo({}, { previousRevisionDate: '2025-10-01' });
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
    expect(ws.agreementFiles[0]).toMatchObject({ source: 'inferred', signals: ['settings'] });
    expect(total).toBe(720);

    const files = twoRevisionFiles();
    const ag = files.find((f) => f.name === 'agreements.csv');
    const two = loadWorkspace(
      [...files, { name: 'agreements_branch.csv', text: ag?.text ?? '' }].map((f) => ({
        name: f.name,
        data: f.text,
      })),
      { previousRevisionDate: '2025-10-01' },
    );
    expect(two.dataset.revisions).toEqual([]);
    expect(two.agreementFiles.map((a) => a.used)).toEqual([false, false]);
    expect(two.warnings).toHaveLength(2);
  });

  it('keeps asking when the signals point to different revisions', () => {
    const { ws } = loadTwo({
      agreementsName: 'revision_2025-04_agreements.csv',
      agreedEffective: '2025-10-01',
    });
    expect(ws.dataset.revisions).toEqual([]);
    expect(ws.agreementFiles[0]).toMatchObject({ used: false, source: null });
    expect(ws.warnings[0]).toContain('使っていません');
    expect(ws.warnings[0]).toContain('令和7年4月1日');
    expect(ws.warnings[0]).toContain('令和7年10月1日');
  });

  it('takes no signal from a file name that holds a period (two year-months)', () => {
    // like the sample's sales_A_202410-202609.csv: the first month is not the revision
    const { ws, total } = loadTwo({ agreementsName: 'agreements_202504-202603.csv' });
    expect(ws.dataset.revisions).toEqual([]);
    expect(ws.agreementFiles[0]).toMatchObject({ date: null, source: null, signals: [], used: false });
    expect(ws.warnings).toHaveLength(1);
    expect(ws.warnings[0]).toContain('使っていません');
    expect(total).toBe(1800);
  });

  it('keeps asking when one month holds two revisions', () => {
    const { ws } = loadTwo({
      agreementsName: 'revision_2025-10_agreements.csv',
      listSteps: [
        [1000, '2024-04-01'],
        [1100, '2025-10-01'],
        [1200, '2025-10-16'],
      ],
    });
    expect(ws.revisionCandidates).toEqual(['2025-10-01', '2025-10-16']);
    expect(ws.dataset.revisions).toEqual([]);
    expect(ws.agreementFiles[0]?.used).toBe(false);
  });

  it('a date the person entered wins over the inferred one', () => {
    const name = 'revision_2025-10_agreements.csv';
    const { ws } = loadTwo(
      { agreementsName: name },
      { revisionDates: { [name]: '2025-04-01' }, previousRevisionDate: '2025-10-01' },
    );
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-04-01']);
    expect(ws.agreementFiles[0]).toMatchObject({ source: 'entered', date: '2025-04-01', used: true });
    expect(ws.notes.filter((n) => n.includes('改定として扱いました'))).toEqual([]);
  });

  it('reports an entered date on which no 定価 changed as not used', () => {
    const { ws, total } = loadTwo({}, { revisionDates: { 'agreements.csv': '2025-10-02' } });
    expect(ws.agreementFiles[0]).toMatchObject({
      source: 'entered',
      date: '2025-10-02',
      inHistory: false,
      used: false,
    });
    expect(ws.warnings).toHaveLength(1);
    expect(ws.warnings[0]).toContain('定価が変わった商品');
    expect(ws.warnings[0]).toContain('令和7年10月2日');
    expect(total).toBe(1800);
  });

  it('assigns a single file to the single revision of the history, as before', () => {
    const { ws } = loadTwo({
      listSteps: [
        [1000, '2024-04-01'],
        [1200, '2025-10-01'],
      ],
    });
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-10-01']);
    expect(ws.agreementFiles[0]).toMatchObject({ source: 'only_revision', signals: [], used: true });
    expect(ws.notes[0]).toContain('定価の履歴から判断');
  });

  it('reads the year and month from a file name', () => {
    expect(yearMonthsInName('revision_2025-10_agreements.csv')).toEqual(['2025-10']);
    expect(yearMonthsInName('合意状況_2025_10.csv')).toEqual(['2025-10']);
    expect(yearMonthsInName('agreements202510.csv')).toEqual(['2025-10']);
    expect(yearMonthsInName('agreements_20251001.csv')).toEqual(['2025-10']);
    expect(yearMonthsInName('2024-04/revision_2025-10_agreements.csv')).toEqual(['2025-10']);
    expect(yearMonthsInName('C:\\data\\2024-04\\agreements_2025.06.csv')).toEqual(['2025-06']);
    expect(yearMonthsInName('agreements.csv')).toEqual([]);
    expect(yearMonthsInName('agreements_2025-13.csv')).toEqual([]);
    expect(yearMonthsInName('code_120251001.csv')).toEqual([]);
  });

  it('reads previousRevisionDate from a settings JSON', () => {
    expect(previousRevisionDateFromJson({ previousRevisionDate: '2025-06-16' })).toBe('2025-06-16');
    expect(previousRevisionDateFromJson({ previousRevisionDate: '2025-02-30' })).toBeNull();
    expect(previousRevisionDateFromJson({ previousRevisionDate: 20250616 })).toBeNull();
    expect(previousRevisionDateFromJson(null)).toBeNull();
  });
});

describe('agreements rows the app cannot take as written', () => {
  // the file name names the revision, so the file is used
  const used = 'revision_2025-10_agreements.csv';
  const A = '000001,株式会社甲見本商事（架空）,2025-07-01,2025-08-01';
  const B = '000002,乙見本工業株式会社（架空）,2025-07-01,2025-08-01';
  const CATEGORIES =
    'カテゴリコード,カテゴリ名,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%),主な原材料\nDB,段ボール・紙器,55,15,15,15,段ボール原紙\n';

  function load(rows: string[], extra: { name: string; data: string }[] = []) {
    const ws = loadWorkspace([
      ...twoRevisionFiles({ agreementsName: used, agreementRows: rows }).map((f) => ({
        name: f.name,
        data: f.text,
      })),
      ...extra,
    ]);
    expect(ws.agreementFiles[0]?.used).toBe(true);
    const total = diagnose(ws.dataset, ws.sales.get('sales.csv') ?? []).summary.reduce(
      (s, x) => s + x.annualImpactYen,
      0,
    );
    return { ws, total };
  }

  it('keeps a 協議中 customer whose 適用日 is 未定 on the old 定価, without a warning', () => {
    const { ws, total } = load([`${A},合意,2025-10-01,,`, `${B},協議中,未定,,`]);
    expect(ws.importIssues).toEqual([]);
    expect(ws.dataset.applicableList('000002', 'DB-2001', '2025-11-11')).toMatchObject({
      price: 1100,
      basis: 'kept_negotiating',
    });
    // only 000001's line at the old price; 000002's correct old prices are not 反映漏れ
    expect(total).toBe(720);
    expect(ws.agreementWarnings).toEqual([]);
    expect(ws.warnings).toEqual([]);
  });

  it('treats an agreed customer whose 適用日 is 未定 as still on the old 定価, with a warning naming it', () => {
    const { ws, total } = load([`${A},合意,未定,,`, `${B},見送り,,,`]);
    expect(ws.dataset.applicableList('000001', 'DB-2003', '2025-11-10')).toMatchObject({
      price: 1100,
      basis: 'kept_before_agreed_date',
    });
    expect(total).toBe(0);
    expect(ws.agreementWarnings).toHaveLength(1);
    const w = ws.agreementWarnings[0] ?? '';
    expect(w).toContain('000001');
    expect(w).toContain('甲見本商事');
    expect(w).toContain('「未定」');
    expect(w).toContain('旧定価');
    expect(ws.warnings).toContain(w);
  });

  it('says which customer is treated as agreed when its row cannot be read', () => {
    const { ws, total } = load([`${A},合意,2025-10-01,,`, `${B},合意,来春,,`]);
    expect(ws.importIssues).toHaveLength(1);
    // 000002 has no readable answer: the new 定価 applies (as for a customer missing from the file)
    expect(ws.dataset.applicableList('000002', 'DB-2001', '2025-11-11')?.basis).toBe('current');
    expect(total).toBe(1800);
    expect(ws.agreementWarnings).toHaveLength(1);
    const w = ws.agreementWarnings[0] ?? '';
    expect(w).toContain(used);
    expect(w).toContain('000002');
    expect(w).toContain('乙見本工業');
    expect(w).toContain('合意したものとして扱っています');
    expect(w).toContain('来春');
  });

  it('reads 対象外カテゴリ written as a category name, and warns about one that matches nothing', () => {
    const named = load(
      [`${A},一部合意,2025-10-01,段ボール・紙器,`, `${B},見送り,,,`],
      [{ name: 'categories.csv', data: CATEGORIES }],
    );
    expect(named.ws.dataset.applicableList('000001', 'DB-2003', '2025-11-10')?.basis).toBe(
      'kept_excluded_category',
    );
    // 1-1 (864円) is now above the kept price, 1-2 (792円) is correct
    expect(named.total).toBe(0);
    expect(named.ws.agreementWarnings).toEqual([]);

    // without the categories file, the products' own category codes still match
    const code = load([`${A},一部合意,2025-10-01,db,`, `${B},見送り,,,`]);
    expect(code.ws.dataset.applicableList('000001', 'DB-2003', '2025-11-10')?.basis).toBe(
      'kept_excluded_category',
    );
    expect(code.ws.agreementWarnings).toEqual([]);

    const unknown = load(
      [`${A},合意,2025-10-01,,`, `${B},一部合意,2025-10-01,梱包材,`],
      [{ name: 'categories.csv', data: CATEGORIES }],
    );
    expect(unknown.ws.dataset.applicableList('000002', 'DB-2001', '2025-11-11')?.basis).toBe('current');
    expect(unknown.ws.agreementWarnings).toHaveLength(1);
    const w = unknown.ws.agreementWarnings[0] ?? '';
    expect(w).toContain('000002');
    expect(w).toContain('乙見本工業');
    expect(w).toContain('「梱包材」');
  });

  it.each([
    ['協議中 with 適用日「保留」', `${B},協議中,保留,,`],
    ['見送り with 適用日「未定（4月予定）」', `${B},見送り,未定（4月予定）,,`],
    ['見送り with 回答日「3月中旬」', '000002,乙見本工業株式会社（架空）,2025-07-01,3月中旬,見送り,,,'],
  ])('keeps a declined or negotiating customer on the old 定価 whatever its dates say (%s)', (_, row) => {
    const { ws, total } = load([`${A},合意,2025-10-01,,`, row]);
    expect(ws.dataset.applicableList('000002', 'DB-2001', '2025-11-11')?.price).toBe(1100);
    expect(total).toBe(720);
    expect(ws.agreementWarnings).toEqual([]);
  });

  it.each([
    ['', '得意先コード'],
    ['乙見本工業', '乙見本工業'],
    ['000009', '000009'],
  ])(
    'names a row whose 得意先コード is %j (blank, not a code, or not in the customer master)',
    (code, shown) => {
      const { ws, total } = load([
        `${A},合意,2025-10-01,,`,
        `${code},乙見本工業株式会社（架空）,2025-07-01,2025-08-01,見送り,,,`,
      ]);
      // 000002 has no answer: the new 定価 applies, and the app says so
      expect(total).toBe(1800);
      expect(ws.agreementWarnings).toHaveLength(1);
      const w = ws.agreementWarnings[0] ?? '';
      expect(w).toContain(used);
      expect(w).toContain(shown);
      expect(w).toContain('合意したものとして扱');
    },
  );

  it('reads 「合意（適用日未定）」 with a blank 適用日 as not applied yet, with a warning naming the customer', () => {
    const { ws, total } = load([`${A},合意（適用日未定）,,,`, `${B},見送り,,,`]);
    expect(ws.dataset.applicableList('000001', 'DB-2003', '2025-11-10')?.basis).toBe(
      'kept_before_agreed_date',
    );
    expect(total).toBe(0);
    expect(ws.agreementWarnings).toHaveLength(1);
    expect(ws.agreementWarnings[0]).toContain('得意先 000001');
    expect(ws.agreementWarnings[0]).toContain('「未定」');
  });

  it('does not warn about the rows of a file the diagnosis does not use', () => {
    const ws = loadWorkspace(
      twoRevisionFiles({
        agreementsName: used,
        agreementRows: [`${A},合意,未定,,`, `${B},合意,2025-10-01,梱包材,`],
      }).map((f) => ({ name: f.name, data: f.text })),
      { revisionDates: { [used]: '2025-09-01' } },
    );
    expect(ws.agreementFiles[0]?.used).toBe(false);
    // the file does nothing: the new 定価 applies, as the unused-file warning says
    expect(ws.dataset.applicableList('000001', 'DB-2003', '2025-11-10')?.basis).toBe('current');
    expect(ws.agreementWarnings).toEqual([]);
    expect(ws.warnings).toHaveLength(1);
    expect(ws.warnings[0]).toContain('診断に効いていません');
  });

  it('does not report the same answer written two ways as a conflict', () => {
    const osaka = 'revision_2025-10_agreements_osaka.csv';
    const second = `${AGREEMENTS_HEADER}\n${A},一部合意,2025-10-01,段ボール・紙器,\n${B},協議中,未定,,\n`;
    const { ws } = load(
      [`${A},一部合意,2025-10-01,DB,`, `${B},協議中,,,`],
      [
        { name: 'categories.csv', data: CATEGORIES },
        { name: osaka, data: second },
      ],
    );
    expect(ws.agreementFiles.map((f) => f.used)).toEqual([true, true]);
    expect(ws.dataset.issues.filter((i) => i.kind === 'conflicting_agreement')).toEqual([]);

    // a different answer is still a conflict: 合意 from 2025-10-01 vs 合意 with no date yet
    const differ = load(
      [`${A},合意,2025-10-01,,`, `${B},見送り,,,`],
      [{ name: osaka, data: `${AGREEMENTS_HEADER}\n${A},合意,未定,,\n` }],
    );
    expect(differ.ws.dataset.issues.filter((i) => i.kind === 'conflicting_agreement')).toHaveLength(1);
  });

  it('lists a warning once when two files for the same revision say the same thing', () => {
    const osaka = 'revision_2025-10_agreements_osaka.csv';
    const { ws } = load(
      [`${A},合意,2025-10-01,,`, `${B},適用日変更,2025-10-01,,`],
      [{ name: osaka, data: `${AGREEMENTS_HEADER}\n${B},適用日変更,2025-10-01,,\n` }],
    );
    expect(ws.agreementFiles.map((f) => f.used)).toEqual([true, true]);
    expect(ws.agreementWarnings).toHaveLength(1);
    expect(ws.agreementWarnings[0]).toContain('得意先 000002');
    expect(ws.agreementWarnings[0]).toContain('「適用日変更」');
  });
});

describe('per-file import options', () => {
  it('reads a file with a header the layouts do not know, using the column names the user chose', () => {
    const custom = '日付,伝票,明細,顧客番号,品目コード,数量,販売単価\n20250501,1,1,1,db1001,5,504\n';
    const base = [
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: files.products },
      { name: 'tiers.csv', data: files.tiers },
    ];
    expect(() => loadWorkspace([...base, { name: 'custom.csv', data: custom }])).toThrow(
      LayoutNotRecognisedError,
    );
    const ws = loadWorkspace([
      ...base,
      {
        name: 'custom.csv',
        data: custom,
        import: {
          spec: layoutById('sales-B'),
          columnOverrides: {
            date: '日付',
            slip: '伝票',
            line: '明細',
            cust: '顧客番号',
            sku: '品目コード',
            unitPrice: '販売単価',
          },
        },
      },
    ]);
    const lines = ws.sales.get('custom.csv') ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ cust: '000001', sku: 'DB-1001', unitPrice: 504, date: '2025-05-01' });
  });

  it('builds the same workspace from files imported beforehand', () => {
    const inputs = [
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: files.products },
      { name: 'tiers.csv', data: files.tiers },
      { name: 'sales.csv', data: files.sales },
    ];
    const a = loadWorkspace(inputs);
    const b = workspaceFromImports(inputs.map((f) => importFile(f.name, f.data)));
    expect(b.sales).toEqual(a.sales);
    expect([...b.dataset.customers.keys()]).toEqual([...a.dataset.customers.keys()]);
  });
});

describe('settings and company', () => {
  it('reads demo_settings.json', () => {
    const s = settingsFromJson({
      marginFloorPct: 12.5,
      unitPriceRounding: 'round',
      listPriceRounding: { below1000: 10, below10000: 50, otherwise: 100 },
    });
    expect(s.marginFloorBp).toBe(1250);
    expect(s.unitRounding).toBe('round');
    expect(s.listRounding?.bands[1]).toEqual({ below: 10000, unit: 50 });
    expect(settingsFromJson(null)).toEqual({});
    expect(settingsFromJson({ unitPriceRounding: 'banker' })).toEqual({});
  });

  it('reads company.json', () => {
    expect(companyFromJson({ name: '架空商事株式会社', branches: ['本社営業部', 3] })).toMatchObject({
      name: '架空商事株式会社',
      branches: ['本社営業部'],
      tel: '',
    });
    expect(companyFromJson('x').name).toBe('');
  });
});
