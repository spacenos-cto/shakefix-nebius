<!-- ShakeFix Patient Chart. The Discharge agent fills this in; humans can use it too. -->
### 🩺 Patient Chart — #<iid>
| | |
|---|---|
| **Symptoms** | <what the user saw, from the reporter note and replay> |
| **Diagnosis** | <root cause, `path/to/file.ts:line`> |
| **Procedure** | <what changed, 1–3 bullets> |
| **Vitals** | regression spec ❌→✅ · unit ✅ · Second Opinion: _n_ intended / _m_ unintended |
| **Discharge** | <next step / who> |

_— Discharge, ShakeFix ER_

#### Autonomy
- [ ] Hands-off (no policy hits, Attending approved, confidence ≥ 0.7)
- [ ] Supervised (`needs-human`: policy hit or low confidence)

#### Evidence
- Regression spec: `tests/regressions/issue-<iid>.spec.ts`
- Medical Record: `.shakefix/memory/cases/<iid>.json` (lessons: `.shakefix/memory/lessons.md`)
- Second Opinion report: posted by the `second_opinion` CI job on this MR

Closes #<iid>

<!-- shakefix:rid=<rid> -->

/label ~"shakefix" ~"shakefix::proof"
