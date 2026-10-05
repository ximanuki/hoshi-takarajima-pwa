import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';
import {
  CHEST_REWARD_STARS,
  QUEST_REWARD_STARS,
  ensureDailyQuestState,
  getQuestStatuses,
  todayKey,
} from '../utils/progression';

export function DailyQuestCard() {
  const storedQuest = useAppStore((state) => state.dailyQuest);
  const claimQuest = useAppStore((state) => state.claimQuest);
  const claimQuestChest = useAppStore((state) => state.claimQuestChest);
  const [toast, setToast] = useState<string | null>(null);

  const today = todayKey();
  const dailyQuest = useMemo(() => ensureDailyQuestState(storedQuest, today), [storedQuest, today]);
  const statuses = useMemo(() => getQuestStatuses(dailyQuest), [dailyQuest]);
  const allClaimed = statuses.every((quest) => quest.claimed);
  const doneCount = statuses.filter((quest) => quest.done).length;
  const claimable = statuses.some((quest) => quest.done && !quest.claimed) || (allClaimed && !dailyQuest.chestClaimed);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  };

  const onClaim = (questId: string) => {
    if (!claimQuest(questId)) return;
    audioManager.playSfx('combo');
    showToast(`⭐ ほしを ${QUEST_REWARD_STARS}こ ゲット！`);
  };

  const onChest = () => {
    if (!claimQuestChest()) return;
    audioManager.playSfx('clear');
    showToast(`🎁 たからばこから ⭐${CHEST_REWARD_STARS}こ！`);
  };

  return (
    <details className="panel quest-strip" open={claimable || undefined}>
      <summary className="panel-title">
        <span>📜 きょうの クエスト {claimable ? '❗' : ''}</span>
        <small>
          {doneCount}/{statuses.length} ▾
        </small>
      </summary>

      <ul className="quest-list">
        {statuses.map(({ quest, value, done, claimed }) => (
          <li className={`quest-item ${done ? 'done' : ''} ${claimed ? 'claimed' : ''}`} key={quest.id}>
            <span className="quest-icon" aria-hidden="true">
              {quest.icon}
            </span>
            <div className="quest-body">
              <span className="quest-title">{quest.title}</span>
              <div className="meter thin" aria-hidden="true">
                <div className="meter-fill star" style={{ width: `${(value / quest.target) * 100}%` }} />
              </div>
              <span className="quest-count">
                {value}/{quest.target}
              </span>
            </div>
            {claimed ? (
              <span aria-label="うけとりずみ">✅</span>
            ) : done ? (
              <button className="btn btn-star btn-sm" onClick={() => onClaim(quest.id)}>
                ⭐{QUEST_REWARD_STARS}
              </button>
            ) : (
              <span className="quest-count">⭐{QUEST_REWARD_STARS}</span>
            )}
          </li>
        ))}
      </ul>

      <div className={`chest-row ${allClaimed && !dailyQuest.chestClaimed ? 'ready' : ''}`}>
        <span className="chest-icon" aria-hidden="true">
          {dailyQuest.chestClaimed ? '🎉' : '🎁'}
        </span>
        <span style={{ flex: 1 }}>
          {dailyQuest.chestClaimed ? 'たからばこ ゲットずみ！' : `ぜんぶで たからばこ ⭐${CHEST_REWARD_STARS}`}
        </span>
        {allClaimed && !dailyQuest.chestClaimed ? (
          <button className="btn btn-star btn-sm" onClick={onChest}>
            あける
          </button>
        ) : null}
      </div>

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </details>
  );
}
