# Engagement Audio + FX Spec v2 (Final)

## 1. Objective
Deliver higher immersion and repeat engagement by combining:
- richer scene-based BGM,
- expressive but controlled SFX,
- fast visual reinforcement effects,
- streak-based micro-reward loop.

This v2 incorporates anti-fatigue, performance budgets, and deterministic behavior controls.

## 2. Experience Model

### 2.1 Scene Audio Model
Scenes and intent:
- `home`: calm/warm.
- `mission`: upbeat prep.
- `play`: focused rhythm.
- `result`: celebration.

Transition contract:
1) fade out current BGM (~180ms),
2) switch sequence,
3) fade in new BGM (~260ms).

### 2.2 SFX Model
Effects:
- `tap`, `correct`, `wrong`, `combo`, `clear`.

Cooldowns:
- `tap`: min 70ms interval.
- `combo`: min 900ms interval.
- `correct/wrong/clear`: no forced cooldown.

BGM ducking:
- Every SFX briefly ducks BGM and recovers within ~180ms.

### 2.3 Visual Reward Model
Play page:
- Combo meter (`COMBO xN`) visible during mission.
- Milestone animation pop at streak milestones.
- Feedback text states:
  - correct -> glow + rise.
  - wrong -> soft shake.

Result page:
- Accuracy >= 80% => star-float celebration.
- Accuracy >= 95% => denser star-float.

## 3. Gamification Rules

### 3.1 Correct Streak
- `correctStreak` increments per correct answer.
- Reset to 0 on wrong answer.
- Milestone condition: streak >= 3 and `(streak - 3) % 2 === 0`.
- Milestone reward:
  - play `combo` SFX,
  - show combo pop animation.

### 3.2 Randomness/Variety Policy
- Home hamchee expression/comment variety is deterministic per 15-minute slot + latest result hash.
- This avoids flicker while keeping regular refresh variety.

## 4. Technical Architecture

## 4.1 Files to Change
- `src/utils/audioManager.ts`
- `src/components/SoundController.tsx`
- `src/pages/PlayPage.tsx`
- `src/pages/ResultPage.tsx`
- `src/index.css`

## 4.2 Performance Budget
- Max simultaneous BGM oscillators: 4.
- Max oscillators per SFX event: 3.
- Target active nodes under 12.

## 4.3 Fallback Behavior
- If audio cannot initialize: app remains fully usable.
- Visual feedback (combo meter, animation states, result stars) still active.

## 4.4 Accessibility
- Respect existing sound settings.
- Add `prefers-reduced-motion: reduce` fallback to disable non-essential animation.
- Keep all progress/status understandable via text only.

## 5. QA Checklist
1. Scene BGM changes when route changes (`/`, `/mission`, `/play`, `/result`).
2. All 5 SFX trigger in expected actions.
3. Combo milestones fire exactly at 3,5,7... streak.
4. Visual feedback still clear with sound disabled.
5. Reduced-motion mode disables celebratory animation.
6. Lint/tests/build pass and Pages deploy succeeds.

## 6. Implementation Decision
This spec is approved for implementation in current phase.
