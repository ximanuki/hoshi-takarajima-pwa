import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PokoIllustration } from '../components/PokoIllustration';
import type { PokoMood, PokoPose } from '../components/PokoIllustration';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { ICON_DICTIONARY, ILLUSTRATION_SCENE_DICTIONARY } from '../data/illustrationDictionary';
import { questionBank } from '../data/questions';
import { getQuestionVisual } from '../utils/questionVisuals';

type PreviewItem = {
  id: string;
  title: string;
};

const previewItems: PreviewItem[] = [
  { id: 'l1', title: 'とけい（clock）' },
  { id: 'l49', title: 'おかね合計（money_sum）' },
  { id: 'l61', title: 'おつり（money_change）' },
  { id: 'm405', title: 'ぶんすう（fractions_basic）' },
  { id: 'i61', title: 'ルート（route_optimization）' },
  { id: 'i25', title: 'なかまはずれ（odd_one_out）' },
];

const pokoMoods: Array<{ label: string; value: PokoMood }> = [
  { label: 'ふつう', value: 'normal' },
  { label: 'にっこり', value: 'happy' },
  { label: 'おうえん', value: 'cheer' },
  { label: 'ねむたい', value: 'sleepy' },
];

const pokoPoses: Array<{ label: string; value: PokoPose }> = [
  { label: 'たつ', value: 'stand' },
  { label: 'ジャンプ', value: 'jump' },
];

export function IllustrationPreviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialId = searchParams.get('id')?.trim() || 'i25';
  const [inputId, setInputId] = useState(initialId);
  const [selectedId, setSelectedId] = useState(initialId);
  const [pokoMood, setPokoMood] = useState<PokoMood>('normal');
  const [pokoPose, setPokoPose] = useState<PokoPose>('stand');
  const [error, setError] = useState<string | null>(null);

  const questionMap = useMemo(() => new Map(questionBank.map((question) => [question.id, question])), []);
  const selectedQuestion = questionMap.get(selectedId);
  const visualizableCount = useMemo(
    () => questionBank.filter((question) => getQuestionVisual(question)).length,
    [],
  );

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextId = inputId.trim();

    if (!nextId) {
      setError('IDを入力してね。');
      return;
    }

    if (!questionMap.has(nextId)) {
      setError(`ID「${nextId}」は見つからなかったよ。`);
      return;
    }

    setSelectedId(nextId);
    setError(null);
    setSearchParams({ id: nextId });
  };

  const selectQuickId = (id: string) => {
    setSelectedId(id);
    setInputId(id);
    setError(null);
    setSearchParams({ id });
  };

  return (
    <section className="stack">
      <h1>SVGプレビュー</h1>

      <article className="card preview-card">
        <p>この画面で、実装中のSVGイラストをGUIで確認できます。</p>
        <p>SVGの実装元: `src/components/QuestionIllustration.tsx`</p>
        <p>ポコ実装元: `src/components/PokoIllustration.tsx`</p>
        <p>問題→可視化データ変換: `src/utils/questionVisuals.ts`</p>
        <p>
          イラスト対応:
          {' '}
          {visualizableCount}
          /
          {questionBank.length}
          問
        </p>
        <p>
          アイコン辞書:
          {' '}
          {Object.keys(ICON_DICTIONARY).length}
          {' '}
          語 / シーン辞書:
          {' '}
          {Object.keys(ILLUSTRATION_SCENE_DICTIONARY).length}
          {' '}
          スキル
        </p>
        <p>なかまさがしカードは同じ配色で表示されます（色ヒントなし）。</p>
      </article>

      <article className="card preview-card">
        <h2>ID指定で確認</h2>
        <form className="preview-search" onSubmit={onSubmit}>
          <input
            className="preview-search-input"
            placeholder="例: i25 / l61 / m405"
            value={inputId}
            onChange={(event) => setInputId(event.target.value)}
          />
          <button className="primary-btn" type="submit">
            表示
          </button>
        </form>

        <div className="inline-actions">
          {previewItems.map((item) => (
            <button className="ghost-btn" key={item.id} type="button" onClick={() => selectQuickId(item.id)}>
              {item.id}
            </button>
          ))}
        </div>

        {error ? <p className="hint">⚠️ {error}</p> : null}
      </article>

      {selectedQuestion ? (
        <article className="card preview-card">
          <h2>選択中の問題</h2>
          <p className="preview-meta">
            ID: {selectedQuestion.id} / subject: {selectedQuestion.subject} / skill: {selectedQuestion.skillId}
          </p>
          <p>{selectedQuestion.prompt}</p>
          <QuestionIllustration question={selectedQuestion} />
        </article>
      ) : (
        <article className="card preview-card">
          <p>指定した問題にイラストを表示できませんでした。</p>
        </article>
      )}

      <article className="card preview-card">
        <h2>あいぼう「ポコ」プレビュー</h2>
        <p className="preview-meta">表情とポーズを切り替えて確認できます。</p>
        <div className="inline-actions">
          {pokoMoods.map((mood) => (
            <button
              className={`preview-chip ${pokoMood === mood.value ? 'active' : ''}`}
              key={mood.value}
              type="button"
              onClick={() => setPokoMood(mood.value)}
            >
              {mood.label}
            </button>
          ))}
        </div>
        <div className="inline-actions">
          {pokoPoses.map((pose) => (
            <button
              className={`preview-chip ${pokoPose === pose.value ? 'active' : ''}`}
              key={pose.value}
              type="button"
              onClick={() => setPokoPose(pose.value)}
            >
              {pose.label}
            </button>
          ))}
        </div>
        <PokoIllustration mood={pokoMood} pose={pokoPose} />
      </article>

      <Link className="ghost-btn" to="/settings">
        せっていへ もどる
      </Link>
    </section>
  );
}
