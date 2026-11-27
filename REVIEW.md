# Clinical review record

SokeriSport is an educational simulator. This file records where the numbers come from,
who has looked at them, and what has to happen before a threshold changes.

## Status

| Area | Source | Reviewed by a clinician |
| --- | --- | --- |
| Hypoglycemia stop (<70 mg/dL) | Riddell 2017; ADA Standards of Care | **not yet** |
| Pre-exercise target (90–180, start ≥90) | Riddell 2017; Battelino 2019 (time in range) | **not yet** |
| Ketone / hyperglycemia thresholds (250 / 300) | ADA Standards of Care; Riddell 2017 | **not yet** |
| IOB ceiling before exercise (0.8 U) | Moser 2020 (EASD/ISPAD position statement) | **not yet** |
| Carbohydrate ceiling (50 g single dose, 60 g/h) | Scott 2019; ACSM nutrition guidance | **not yet** |
| Basal reduction ranges (0–80%) | Riddell 2017; Moser 2020 | **not yet** |
| Carb–glucose coefficient (3.5 mg/dL per g at 70 kg) | Colberg 2016 (observed effect, modelling assumption) | **not yet** |
| Sport oxidation rates and sensitivity multipliers | Colberg 2016; Riddell 2017 (assumption, tuned per category) | **not yet** |
| Slow carbohydrate, heat multipliers | Modelling assumptions, marked `[V]` on the science page | **not yet** |

"No clinical review yet" is the honest state: the engine reproduces published thresholds,
but no clinician has signed off on the implementation. Until that changes, the disclaimer
stays on every page and the app must not be presented as a treatment tool.

## Change policy

Any change to a number in `RULES`, `SPORTS`, `CATEGORIES` or `TRENDS` requires:

1. A **source** added to `science.html#sources` and to the table above.
2. A **test** that pins the new behaviour (`tests/engine.test.mjs`).
3. A **golden fixture update** (`npm run golden`) whose diff is reviewed in the pull request —
   the diff *is* the clinical change record.
4. An entry in the log below.

## Log

| Date | Change | Reason | By |
| --- | --- | --- | --- |
| 2026-11-27 | Engine extracted, thresholds documented, 17 engine tests | Initial implementation | Erdal Birinci |
| 2026-11-27 | Slow carbohydrate, heat and split pre-dose added (all `[V]`) | Modelling improvements requested in review | Erdal Birinci |
| 2026-11-27 | Golden fixtures (10 scenarios) and a performance bound added | Make silent clinical drift impossible to merge | Erdal Birinci |

## Open questions for a reviewer

- Is the 0.8 U IOB ceiling safe for high-sensitivity athletes (ISF > 70 mg/dL/U)?
- Should the pre-exercise target start band be 90 or 100 mg/dL for sessions over 90 minutes?
- Is a 35% muscle share in `EXERCISE_DRAW` realistic for interval sports?
- The heat multiplier (×1.12 sensitivity) is an assumption; is a narrower range defensible?
