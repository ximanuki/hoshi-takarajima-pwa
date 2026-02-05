export type IllustrationScene = {
  skillId: string;
  title: string;
  background: 'classroom' | 'road' | 'home' | 'kitchen' | 'shop' | 'logic_board' | 'nature';
  tags: string[];
  defaultTokens: string[];
};

export type IllustrationCategory =
  | 'transport'
  | 'animal'
  | 'food'
  | 'school'
  | 'wear'
  | 'nature'
  | 'time'
  | 'shape'
  | 'action'
  | 'money'
  | 'other';

export const ICON_DICTIONARY: Record<string, string> = {
  // Transport
  でんしゃ: '🚆',
  バス: '🚌',
  ひこうき: '✈️',
  くるま: '🚗',
  じてんしゃ: '🚲',

  // Animals
  いぬ: '🐶',
  ねこ: '🐱',
  さかな: '🐟',
  とり: '🐦',
  うま: '🐴',
  にわとり: '🐔',
  すずめ: '🐦',
  はと: '🕊️',

  // Food
  りんご: '🍎',
  みかん: '🍊',
  さくらんぼ: '🍒',
  ぶどう: '🍇',
  ばなな: '🍌',
  きゅうり: '🥒',
  アイス: '🍨',
  パン: '🍞',
  カレー: '🍛',
  うどん: '🍜',
  ケーキ: '🍰',
  ジュース: '🧃',
  ぎゅうにゅう: '🥛',
  みず: '💧',

  // School / Home
  がっこう: '🏫',
  としょかん: '📚',
  えんぴつ: '✏️',
  けしごむ: '🧽',
  ノート: '📓',
  ランドセル: '🎒',
  ほん: '📘',

  // Clothes / Goods
  ぼうし: '🧢',
  てぶくろ: '🧤',
  ふく: '👕',
  くつ: '👟',
  かさ: '☂️',
  ヘルメット: '⛑️',

  // Places / Nature
  うみ: '🌊',
  こうえん: '🏞️',
  やま: '⛰️',
  かわ: '🏞️',
  そら: '☁️',
  あめ: '🌧️',
  たいふう: '🌪️',
  かみなり: '⚡',
  ひ: '🔥',
  つき: '🌙',
  ほし: '⭐',

  // Time / Calendar
  あさ: '🌅',
  ひる: '☀️',
  よる: '🌃',
  ごご: '🕒',

  // Shapes / Colors
  まる: '⚪',
  さんかく: '🔺',
  しかく: '⬜',
  あか: '🔴',
  あお: '🔵',
  きいろ: '🟡',

  // Actions / Logic
  はしる: '🏃',
  まつ: '⏳',
  つかう: '🛠️',
  たべる: '🍽️',
  のむ: '🥤',
  あそぶ: '🎲',

  // Money
  おかね: '💴',
  '1えん': '🪙',
  '5えん': '🪙',
  '10えん': '🪙',
  '50えん': '🪙',
  '100えん': '🪙',
  '500えん': '🪙',
  '1000えん': '💴',
};

export const ICON_ALIASES: Record<string, string> = {
  いぬさん: 'いぬ',
  ねこさん: 'ねこ',
  さかなさん: 'さかな',
  えんぴつ5ほん: 'えんぴつ',
  けしごむ2こ: 'けしごむ',
  みち: 'でんしゃ',
  ルート: 'でんしゃ',
  コース: 'でんしゃ',
};

const CATEGORY_GROUPS: Record<IllustrationCategory, string[]> = {
  transport: ['でんしゃ', 'バス', 'ひこうき', 'くるま', 'じてんしゃ'],
  animal: ['いぬ', 'ねこ', 'さかな', 'とり', 'うま', 'にわとり', 'すずめ', 'はと'],
  food: [
    'りんご',
    'みかん',
    'さくらんぼ',
    'ぶどう',
    'ばなな',
    'きゅうり',
    'アイス',
    'パン',
    'カレー',
    'うどん',
    'ケーキ',
    'ジュース',
    'ぎゅうにゅう',
    'みず',
  ],
  school: ['がっこう', 'としょかん', 'えんぴつ', 'けしごむ', 'ノート', 'ランドセル', 'ほん'],
  wear: ['ぼうし', 'てぶくろ', 'ふく', 'くつ', 'かさ', 'ヘルメット'],
  nature: ['うみ', 'こうえん', 'やま', 'かわ', 'そら', 'あめ', 'たいふう', 'かみなり', 'ひ', 'つき', 'ほし'],
  time: ['あさ', 'ひる', 'よる', 'ごご'],
  shape: ['まる', 'さんかく', 'しかく', 'あか', 'あお', 'きいろ'],
  action: ['はしる', 'まつ', 'つかう', 'たべる', 'のむ', 'あそぶ'],
  money: ['おかね', '1えん', '5えん', '10えん', '50えん', '100えん', '500えん', '1000えん'],
  other: [],
};

export const ICON_CATEGORY_DICTIONARY: Record<string, IllustrationCategory> = Object.fromEntries(
  (Object.entries(CATEGORY_GROUPS) as Array<[IllustrationCategory, string[]]>).flatMap(([category, tokens]) =>
    tokens.map((token) => [token, category]),
  ),
) as Record<string, IllustrationCategory>;

export const ILLUSTRATION_SCENE_DICTIONARY: Record<string, IllustrationScene> = {
  clock_hour: {
    skillId: 'clock_hour',
    title: 'とけい',
    background: 'classroom',
    tags: ['time', 'clock'],
    defaultTokens: ['あさ', 'ひる', 'よる'],
  },
  clock_half: {
    skillId: 'clock_half',
    title: 'とけい',
    background: 'classroom',
    tags: ['time', 'clock'],
    defaultTokens: ['あさ', 'ひる', 'よる'],
  },
  clock_quarter: {
    skillId: 'clock_quarter',
    title: 'とけい',
    background: 'classroom',
    tags: ['time', 'clock'],
    defaultTokens: ['あさ', 'ひる', 'よる'],
  },
  money_value: {
    skillId: 'money_value',
    title: 'おかね',
    background: 'shop',
    tags: ['money', 'count'],
    defaultTokens: ['おかね'],
  },
  money_sum: {
    skillId: 'money_sum',
    title: 'おかね',
    background: 'shop',
    tags: ['money', 'sum'],
    defaultTokens: ['おかね'],
  },
  money_change: {
    skillId: 'money_change',
    title: 'おつり',
    background: 'shop',
    tags: ['money', 'change'],
    defaultTokens: ['おかね'],
  },
  fractions_basic: {
    skillId: 'fractions_basic',
    title: 'ぶんすう',
    background: 'classroom',
    tags: ['math', 'fraction'],
    defaultTokens: ['ケーキ'],
  },
  route_optimization: {
    skillId: 'route_optimization',
    title: 'ルート',
    background: 'logic_board',
    tags: ['insight', 'strategy'],
    defaultTokens: ['でんしゃ', 'バス', 'ひこうき'],
  },
  odd_one_out: {
    skillId: 'odd_one_out',
    title: 'なかまさがし',
    background: 'logic_board',
    tags: ['insight', 'classification'],
    defaultTokens: ['りんご', 'みかん', 'ぶどう'],
  },
  safety_road: {
    skillId: 'safety_road',
    title: 'こうつうあんぜん',
    background: 'road',
    tags: ['life', 'safety'],
    defaultTokens: ['じてんしゃ', 'ヘルメット', 'くるま'],
  },
  safety_disaster: {
    skillId: 'safety_disaster',
    title: 'ぼうさい',
    background: 'home',
    tags: ['life', 'safety'],
    defaultTokens: ['あめ', 'たいふう', 'かみなり'],
  },
  life_routine: {
    skillId: 'life_routine',
    title: 'せいかつしゅうかん',
    background: 'home',
    tags: ['life', 'habit'],
    defaultTokens: ['ふく', 'くつ', 'みず'],
  },
  cooking_step: {
    skillId: 'cooking_step',
    title: 'りょうり',
    background: 'kitchen',
    tags: ['life', 'cooking'],
    defaultTokens: ['パン', 'カレー', 'みず'],
  },
};

function normalizeToken(token: string): string {
  return token.trim();
}

function resolveCanonicalToken(token: string): string {
  const normalized = normalizeToken(token);
  return ICON_ALIASES[normalized] ?? normalized;
}

export function resolveIconToken(token: string): string | undefined {
  const canonical = resolveCanonicalToken(token);
  const direct = ICON_DICTIONARY[canonical];
  if (direct) return direct;
  return undefined;
}

export function resolveTokenCategory(token: string): IllustrationCategory | undefined {
  const canonical = resolveCanonicalToken(token);
  return ICON_CATEGORY_DICTIONARY[canonical];
}
