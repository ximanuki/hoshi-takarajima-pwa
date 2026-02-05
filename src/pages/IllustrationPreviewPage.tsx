import { Link } from 'react-router-dom';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { questionBank } from '../data/questions';

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

export function IllustrationPreviewPage() {
  return (
    <section className="stack">
      <h1>SVGプレビュー</h1>
      <article className="card">
        <p>この画面で、実装中のSVGイラストをGUIで確認できます。</p>
        <p>SVGの実装元: `src/components/QuestionIllustration.tsx`</p>
        <p>問題→可視化データ変換: `src/utils/questionVisuals.ts`</p>
      </article>

      <div className="preview-grid">
        {previewItems.map((item) => {
          const question = questionBank.find((entry) => entry.id === item.id);
          if (!question) return null;

          return (
            <article className="card preview-card" key={item.id}>
              <h2>{item.title}</h2>
              <p className="preview-meta">
                ID: {question.id} / skill: {question.skillId}
              </p>
              <p>{question.prompt}</p>
              <QuestionIllustration question={question} />
            </article>
          );
        })}
      </div>

      <Link className="ghost-btn" to="/settings">
        せっていへ もどる
      </Link>
    </section>
  );
}
