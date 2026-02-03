import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useAppStore } from '../store/useAppStore';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

export function ParentPage() {
  const recentResults = useAppStore((state) => state.recentResults);
  const recent = useMemo(() => recentResults.slice(0, 7).reverse(), [recentResults]);

  const labels = recent.map((result) => result.date.slice(5, 10));
  const accuracy = recent.map((result) => Math.round((result.correct / result.total) * 100));
  const durationMin = recent.map((result) => Number((result.durationSec / 60).toFixed(1)));

  return (
    <section className="stack">
      <h1>保護者ダッシュボード</h1>
      <div className="card">
        <p>直近7回の正答率（%）</p>
        {recent.length > 0 ? (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: '正答率',
                  data: accuracy,
                  borderColor: '#0f6e6f',
                  backgroundColor: 'rgba(15, 110, 111, 0.2)',
                  tension: 0.35,
                  fill: true,
                },
              ],
            }}
            options={{ responsive: true, plugins: { legend: { display: false } } }}
          />
        ) : (
          <p>まだ学習記録がありません。</p>
        )}
      </div>

      <div className="card">
        <p>学習時間（分）: {durationMin.join(' / ') || '-'}</p>
      </div>
    </section>
  );
}
