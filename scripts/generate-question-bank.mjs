import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourcePath = resolve(root, 'docs/question_bank_master.md');
const outputPath = resolve(root, 'src/data/questions.generated.ts');

const START = '<!-- QUESTION_TABLE_START -->';
const END = '<!-- QUESTION_TABLE_END -->';

function parseTable(markdown) {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Question table markers were not found in docs/question_bank_master.md');
  }

  const section = markdown.slice(start + START.length, end).trim();
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  if (lines.length < 3) {
    throw new Error('Question table must include header, separator, and at least one row.');
  }

  const rows = lines.slice(2);

  return rows.map((line, index) => {
    const cols = line
      .split('|')
      .slice(1, -1)
      .map((value) => value.trim());

    if (cols.length !== 10) {
      throw new Error(`Row ${index + 1} has ${cols.length} columns, expected 10.`);
    }

    const [id, subject, skillId, difficultyRaw, prompt, choice1, choice2, choice3, answerRaw, hint] = cols;
    const difficulty = Number(difficultyRaw);
    const answerIndex = Number(answerRaw);

    if (!id) throw new Error(`Row ${index + 1}: id is required.`);
    if (!['math', 'japanese'].includes(subject)) {
      throw new Error(`Row ${index + 1}: subject must be math|japanese.`);
    }
    if (!skillId) throw new Error(`Row ${index + 1}: skillId is required.`);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      throw new Error(`Row ${index + 1}: difficulty must be an integer 1..5.`);
    }
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 2) {
      throw new Error(`Row ${index + 1}: answerIndex must be 0..2.`);
    }

    const choices = [choice1, choice2, choice3];

    return {
      id,
      subject,
      skillId,
      difficulty,
      prompt,
      choices,
      answerIndex,
      hint,
    };
  });
}

const markdown = readFileSync(sourcePath, 'utf8');
const questionBank = parseTable(markdown);

const file = `import type { Question } from '../types';\n\n` +
  `// Auto-generated from docs/question_bank_master.md by scripts/generate-question-bank.mjs\n` +
  `export const questionBank: Question[] = ${JSON.stringify(questionBank, null, 2)};\n`;

writeFileSync(outputPath, file, 'utf8');
console.info(`Generated ${outputPath} with ${questionBank.length} questions.`);
