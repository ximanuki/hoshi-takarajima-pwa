import { useEffect, useState } from 'react';
import { loadVoiceManifest } from '../utils/speech';

/** ずんだもんの おんせいを つかっている ときの クレジット（VOICEVOX の りようきやく） */
export function VoiceCredit() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadVoiceManifest().then((keys) => {
      if (alive) setCount(keys.size);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (count === 0) return null;
  return (
    <p className="muted on-night" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
      おんせい: VOICEVOX:ずんだもん
    </p>
  );
}
