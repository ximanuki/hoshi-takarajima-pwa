import { useEffect, useState } from 'react';
import { getSfxCredit, loadSfxManifest } from '../utils/audioManager';
import { getVoiceCredit, loadVoiceManifest } from '../utils/speech';

/** VOICEVOX の おんせい・こうかおんを つかっている ときの クレジット（りようきやくで ひつよう） */
export function VoiceCredit() {
  const [credits, setCredits] = useState<{ voice: string | null; sfx: string | null }>({ voice: null, sfx: null });

  useEffect(() => {
    let alive = true;
    void Promise.all([loadVoiceManifest(), loadSfxManifest()]).then(() => {
      if (alive) setCredits({ voice: getVoiceCredit(), sfx: getSfxCredit() });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!credits.voice && !credits.sfx) return null;
  return (
    <p className="muted on-night" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
      {credits.voice && <>おんせい: {credits.voice}</>}
      {credits.voice && credits.sfx && <br />}
      {credits.sfx && <>こうかおん: {credits.sfx}</>}
    </p>
  );
}
