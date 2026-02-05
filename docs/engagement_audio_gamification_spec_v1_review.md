# Engagement Audio + FX Spec v1 Review

## Review Summary
v1 is directionally strong but not yet "ultimate quality" due to three major gaps:
1) insufficient anti-fatigue controls,
2) undefined deterministic randomization policy,
3) missing fallback behavior when audio context is unavailable.

## Detailed Findings

### [F1] Anti-fatigue control is underspecified
Issue:
- v1 defines richer feedback but does not cap repeated triggers.
Risk:
- Frequent combo/tap sounds can become noisy in rapid interactions.

Required fix:
- Add cooldowns:
  - `tap` min interval: 70ms.
  - `combo` min interval: 900ms.
  - `clear` can always play.

### [F2] Scene transition quality risk
Issue:
- "soft fade" is stated but exact timings and stop/start order are not specified.
Risk:
- Audible pops or abrupt transitions.

Required fix:
- Define transition sequence:
  1) fade out old BGM to 0 over ~180ms,
  2) switch pattern,
  3) fade in new BGM to scene target over ~260ms.

### [F3] Performance ceiling not explicitly bounded
Issue:
- Node count per beat not bounded.
Risk:
- Node churn spikes on low-end mobile.

Required fix:
- Hard budget:
  - Max simultaneous oscillators for BGM: 4.
  - Max per SFX event: 3.
  - Total active nodes target < 12.

### [F4] No deterministic behavior policy for mood/comment variety
Issue:
- "variety" can flicker if random source changes too often.
Risk:
- Visual inconsistency and user confusion.

Required fix:
- Use time-slot deterministic seed (15-min bucket) + latest result hash.
- Keep variety stable within bucket, rotate across buckets.

### [F5] Missing no-audio fallback path
Issue:
- If WebAudio unavailable, behavior undefined.
Risk:
- Silent failure without reinforcement.

Required fix:
- Ensure visual feedback fully carries reward loop:
  - combo badge + feedback effects remain independent from audio.

## Scope Adjustment Decision
To keep delivery quality high and risk controlled, v2 will:
- include anti-fatigue cooldowns,
- include deterministic mood/FX behavior policy,
- include strict audio node budget,
- keep persistence schema unchanged.

## Re-evaluation Outcome
After incorporating above fixes, implementation can proceed safely in current sprint.
