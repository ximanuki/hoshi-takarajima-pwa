# Engagement Audio + FX Spec v1

## 1. Goal
Raise session stickiness and emotional feedback quality by upgrading:
1) BGM richness,
2) SFX clarity and reward response,
3) moment-to-moment motion/effects,
4) short-loop gamification reinforcement.

Primary KPI intent (product-side):
- Longer mission completion sessions.
- Higher voluntary next-mission tap rate.
- Lower perceived repetition/fatigue.

## 2. Constraints
- PWA + GitHub Pages static hosting.
- No external paid asset/CDN dependency for core playback.
- Existing settings model (`soundEnabled`, `bgmVolume`, `sfxVolume`) must remain valid.
- Must remain playable on mobile browsers with autoplay restrictions.

## 3. Experience Principles
1. Immediate feedback (<150ms) for all key actions.
2. Positive reinforcement rhythm (small wins every 1-3 interactions).
3. Non-fatiguing loops (audio/motion subtle while repeated).
4. Fail-safe accessibility (sound-off still understandable, reduced-motion respected).

## 4. Feature Scope (v1)

### 4.1 Audio Upgrade
#### A) Scene-aware BGM
Define 4 scene modes:
- `home`: warm, calm.
- `mission`: energetic prep.
- `play`: focus rhythm.
- `result`: celebratory.

Behavior:
- Keep WebAudio synth-based generation (no large downloads).
- BGM loop changes by scene (tempo/melody/bass pattern).
- Switch scenes without abrupt cut (stop old loop, soft fade to new loop).

#### B) Expanded SFX palette
Add effects:
- `tap`: UI selection.
- `correct`: answer correct.
- `wrong`: answer wrong.
- `combo`: streak milestone.
- `clear`: mission clear.

Behavior:
- Every SFX event ducks BGM briefly (short volume dip then recover).
- `combo` only at streak milestone to avoid spam.

### 4.2 Gamification Feedback Loop
#### A) Correct-streak combo (in-play)
- Track `correctStreak` per mission in Play UI only.
- On wrong answer, streak resets to 0.
- On correct answers, streak increments.
- Combo milestone at streak >= 3 and every +2 thereafter.

Reward at milestone:
- Trigger `combo` SFX.
- Show animated combo badge (`COMBO xN`) for ~650ms.

#### B) Immediate progress emotion
- Feedback message gets visual state:
  - correct -> green glow + rise animation.
  - wrong -> orange shake-soft animation.

### 4.3 Visual FX / Motion
#### A) Play page
- Add combo meter card under progress.
- Add brief burst around feedback text on combo trigger.
- Keep transitions under 700ms to avoid blocking flow.

#### B) Result page
- If accuracy >= 80%, render star-float celebration layer.
- If accuracy >= 95%, stronger star density.

#### C) Home page
- Keep existing hamchee bubble system.
- No extra heavy animation in v1 (to prevent motion overload).

## 5. Technical Design

### 5.1 Modules
- `src/utils/audioManager.ts`
  - add scene state + `setScene(scene)`
  - add expanded sfx type
  - add bgm ducking
  - add scene-based melody/bass patterns
- `src/components/SoundController.tsx`
  - map route to scene and call `setScene`
- `src/pages/PlayPage.tsx`
  - add streak/combo UI state
  - trigger `tap`/`combo` SFX
- `src/pages/ResultPage.tsx`
  - add celebration visual layer
- `src/index.css`
  - combo, feedback, star animations, reduced-motion fallbacks

### 5.2 Data/State
- Do not change persisted store schema for this phase.
- Keep streak/combo ephemeral to mission session.
- Avoid introducing server dependencies.

### 5.3 Accessibility
- Sound optional via existing settings.
- Add `prefers-reduced-motion: reduce` rules for all new animations.
- Maintain text feedback even when sound/effects are off.

## 6. Acceptance Criteria
1. Route changes alter BGM style audibly within 1 second.
2. `tap`, `correct`, `wrong`, `combo`, `clear` are each triggerable in app flow.
3. Combo badge appears and disappears correctly at defined milestones.
4. Result celebration appears only at configured accuracy threshold.
5. Existing tests/lint/build pass.

## 7. Risk Notes
- Over-stimulation risk if effects stack too often.
- WebAudio on low-end devices may crackle if too many simultaneous nodes.
- Route-based BGM changes can feel abrupt if fade timing is too short.

## 8. Rollout Plan
1. Implement audio engine updates.
2. Integrate scene switching in controller.
3. Add play-page combo logic/UI.
4. Add result celebration visuals.
5. Tune volumes/timings by manual playtest.
