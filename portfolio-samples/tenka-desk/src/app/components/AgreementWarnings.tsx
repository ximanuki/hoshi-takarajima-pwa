import { num } from '../format.ts';
import { Notice } from './ui.tsx';

const SHOWN = 20;

/**
 * Rows of the agreements file that the diagnosis could not take as written, one line
 * per customer (Workspace.agreementWarnings): a row left out (the customer is treated
 * as 合意), 合意 with a 適用日 of 「未定」, a 対象外カテゴリ that matches no category.
 */
export function AgreementWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div data-testid="agreement-warnings">
      <Notice tone="warning" title="合意状況のファイルに、書いたとおりに読めなかった行があります">
        <ul>
          {warnings.slice(0, SHOWN).map((w) => (
            <li key={w}>{w}</li>
          ))}
          {warnings.length > SHOWN && <li>ほか {num(warnings.length - SHOWN)}件</li>}
        </ul>
      </Notice>
    </div>
  );
}
