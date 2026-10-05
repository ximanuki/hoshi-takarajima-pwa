import { useEffect, useState } from 'react';
import { getVoiceCredit, loadVoiceManifest } from '../utils/speech';

/** VOICEVOX の おんせいを つかっている ときの クレジット（りようきやくで ひつよう） */
export function VoiceCredit() {
  const [credit, setCredit] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadVoiceManifest().then(() => {
      if (alive) setCredit(getVoiceCredit());
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!credit) return null;
  return (
    <p className="muted on-night" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
      おんせい: {credit}
    </p>
  );
}
