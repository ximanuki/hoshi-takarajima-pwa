export type PokoMood = 'normal' | 'happy' | 'cheer' | 'sleepy';

const HAMCHEE_IMAGE_BY_MOOD: Record<PokoMood, string> = {
  normal: 'hamchee_idle.webp',
  happy: 'hamchee_happy.webp',
  cheer: 'hamchee_cheer.webp',
  sleepy: 'hamchee_sleepy.webp',
};

export function hamcheeSrc(mood: PokoMood): string {
  return `${import.meta.env.BASE_URL}assets/hamchee/${HAMCHEE_IMAGE_BY_MOOD[mood]}`;
}
