import type { Subject } from '../types';

// ボスは「たおす」のではなく、せいかいで ハートを あつめて「なかよし」に なる あいて。
export type Boss = { name: string; sprite: string; taunt: string; befriend: string; escape: string };

export const bosses: Record<Subject, Boss> = {
  math: {
    name: 'いたずらタコちゃん',
    sprite: '🐙',
    taunt: 'タコタコ〜♪ まだまだ！',
    befriend: 'なかよしに なろうタコ！',
    escape: 'またね〜タコ〜！',
  },
  japanese: {
    name: 'もじもじドラゴン',
    sprite: '🐲',
    taunt: 'うふふ、よめるかな？',
    befriend: 'いっしょに あそぼう！',
    escape: 'また きてね〜！',
  },
  life: {
    name: 'ちょきちょきカニさん',
    sprite: '🦀',
    taunt: 'チョキチョキ♪ ざんねん！',
    befriend: 'きみ、すてきカニ！',
    escape: 'すなはまで まってるカニ！',
  },
  insight: {
    name: 'なぞなぞフクロウ',
    sprite: '🦉',
    taunt: 'ホッホー、むずかしかろう？',
    befriend: 'ホホッ、ともだちじゃ！',
    escape: 'また なぞなぞ しようぞ！',
  },
  nature: {
    name: 'もりもりザウルス',
    sprite: '🦖',
    taunt: 'ガオ〜♪ まだ いけるよ！',
    befriend: 'なかよし ザウルス！',
    escape: 'もりで まってるね！',
  },
};
