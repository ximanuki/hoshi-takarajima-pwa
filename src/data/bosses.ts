import type { Subject } from '../types';

export type Boss = { name: string; sprite: string; taunt: string; defeat: string };

export const bosses: Record<Subject, Boss> = {
  math: { name: 'かずダコ', sprite: '🐙', taunt: 'タコタコ〜！ まだまだ！', defeat: 'まいった タコ〜！' },
  japanese: { name: 'もじドラゴン', sprite: '🐲', taunt: 'ガオー！ よめるかな？', defeat: 'おぬし、やるな…！' },
  life: { name: 'くらしガニ', sprite: '🦀', taunt: 'チョキチョキ！ ゆだん たいてき！', defeat: 'カニカニ… おてあげ！' },
  insight: { name: 'なぞフクロウ', sprite: '🦉', taunt: 'ホッホー、むずかしかろう？', defeat: 'ホホッ、みごとじゃ！' },
  nature: { name: 'もりザウルス', sprite: '🦖', taunt: 'ズシーン！ まだ いけるぞ！', defeat: 'ぐぬぬ… つよいな！' },
};
