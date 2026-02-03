import type { Question } from '../types';

export const questionBank: Question[] = [
  { id: 'm1', subject: 'math', prompt: '3 + 2 は いくつ？', choices: ['4', '5', '6'], answerIndex: 1, hint: '3の つぎは 4、そのつぎは 5。' },
  { id: 'm2', subject: 'math', prompt: '7 - 4 は いくつ？', choices: ['2', '3', '4'], answerIndex: 1, hint: '7から 4こ もどる。' },
  { id: 'm3', subject: 'math', prompt: '5 と 8、どちらが おおきい？', choices: ['5', '8', 'おなじ'], answerIndex: 1, hint: 'かずが おおきいほうを えらぼう。' },
  { id: 'm4', subject: 'math', prompt: '1 + 6 は いくつ？', choices: ['6', '7', '8'], answerIndex: 1, hint: '1たすと つぎの かず。' },
  { id: 'm5', subject: 'math', prompt: '9 - 3 は いくつ？', choices: ['5', '6', '7'], answerIndex: 1, hint: '9から 3こ へらす。' },
  { id: 'm6', subject: 'math', prompt: '4 + 4 は いくつ？', choices: ['6', '7', '8'], answerIndex: 2, hint: '4が 2つで 8。' },
  { id: 'm7', subject: 'math', prompt: '6 - 2 は いくつ？', choices: ['3', '4', '5'], answerIndex: 1, hint: '6から 2こ ひく。' },
  { id: 'm8', subject: 'math', prompt: '2 + 5 は いくつ？', choices: ['6', '7', '8'], answerIndex: 1, hint: '2から 5こ すすめる。' },
  { id: 'm9', subject: 'math', prompt: '10 - 1 は いくつ？', choices: ['8', '9', '10'], answerIndex: 1, hint: '1こだけ もどる。' },
  { id: 'm10', subject: 'math', prompt: '3 と 3 は どうなる？', choices: ['3', '6', '9'], answerIndex: 1, hint: '3たす3。' },
  { id: 'j1', subject: 'japanese', prompt: '「いぬ」は どれ？', choices: ['🐶', '🐱', '🐟'], answerIndex: 0, hint: 'わんわん なく どうぶつ。' },
  { id: 'j2', subject: 'japanese', prompt: '「あ」の つぎの もじは？', choices: ['い', 'う', 'え'], answerIndex: 0, hint: 'あいうえお の じゅんばん。' },
  { id: 'j3', subject: 'japanese', prompt: '「そら」に いちばん ちかい えは？', choices: ['☁️', '🍎', '🚗'], answerIndex: 0, hint: 'おそらに うかぶ もの。' },
  { id: 'j4', subject: 'japanese', prompt: '「かさ」は どれ？', choices: ['☂️', '🧢', '👟'], answerIndex: 0, hint: 'あめの ひに つかう。' },
  { id: 'j5', subject: 'japanese', prompt: '「き」の もじを えらぼう', choices: ['さ', 'き', 'ち'], answerIndex: 1, hint: 'かきくけこ の さいしょ。' },
  { id: 'j6', subject: 'japanese', prompt: '「みず」に ちかい えは？', choices: ['🔥', '💧', '🌳'], answerIndex: 1, hint: 'のどが かわいたら のむ。' },
  { id: 'j7', subject: 'japanese', prompt: '「おはよう」は いつ？', choices: ['あさ', 'ひる', 'よる'], answerIndex: 0, hint: 'ねおきに いうことば。' },
  { id: 'j8', subject: 'japanese', prompt: '「やま」は どれ？', choices: ['🏔️', '🌊', '🏠'], answerIndex: 0, hint: 'たかい じめん。' },
  { id: 'j9', subject: 'japanese', prompt: '「え」の まえの もじは？', choices: ['う', 'お', 'か'], answerIndex: 0, hint: 'あいうえお。' },
  { id: 'j10', subject: 'japanese', prompt: '「たべる」に ちかい えは？', choices: ['🍚', '😴', '🏃'], answerIndex: 0, hint: 'ごはんを どうする？' },
];
