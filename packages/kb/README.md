# Disha knowledge base

All of Disha's domain data lives here as JSON. The web app bundles it so everything works offline, and `scripts/load_kb.py` loads it into PostgreSQL for the API. Teachers, NGOs and volunteers can extend it without changing code.

## Files

| Path | Contents |
| --- | --- |
| `skills.json` | 25 skills: `id`, `cluster`, `name` (`en`/`ta`), `aliases` used by the keyword matcher |
| `graph/subskills.json` | 32 measurable sub-skills, each with four level descriptions, three IRT cut-points (`cuts`), and an under-18 hazard flag |
| `graph/aptitudes.json` | 3 aptitudes and the games that measure them |
| `graph/edges.json` | Links between nodes. `NEEDS`: a career needs a sub-skill at a level, with a weight. `NEEDS_APTITUDE`: a career benefits from an aptitude. `RELATED`: sub-skills that share evidence when spreading |
| `occupations.json` | Careers: sector, RIASEC code, minimum education, skills, pathway steps, exams, local demand in Tamil Nadu |
| `schemes.json` | Scholarships, schemes and opportunities: benefit, documents needed, apply link |
| `rules/<scheme_id>.json` | The eligibility rule for each scheme, with test fixtures |
| `items/<area>.json` | Test questions (`choice`, `estimate`, `order_steps`) and aptitude puzzles, with IRT difficulty `b` and discrimination `a` |
| `rubrics/<skill>.json` | Work-sample checklists: what to photograph and the criteria to score |

## Rules for every record

- **Cite a source.** Careers and schemes need a `source_url` to an official or reputable page. Keep `"needs_verification": true` until a second person checks it.
- **Rules decide eligibility, not the AI.** Income limits, ages and classes must come from the current year's official page. Note the date in `updated`.
- **Every rule needs fixtures**: at least one student who qualifies and one who doesn't.
- **Use known IDs only.** Skills and sub-skills must exist in `skills.json` and `graph/subskills.json`. Sectors must be one of: `stem`, `vocational`, `agri`, `creative`, `services`, `govt`, `health`, `entrepreneurship`.
- **Questions start unreviewed.** New questions have `"reviewed": false` until a teacher checks the wording and the Tamil.
- **Tamil text** goes in the `ta` field next to `en`. Leave it `null` rather than machine-translating it without review.

## Eligibility rules

Rules use [JSON Logic](https://jsonlogic.com). Example (`rules/sch_nmms.json`, shortened):

```json
{
  "id": "sch_nmms",
  "updated": "2026-11-11",
  "rule": {"and": [
    {"==": [{"var": "current_class"}, 8]},
    {"in": [{"var": "school_type"}, ["govt", "aided"]]},
    {"<=": [{"var": "family_income_inr"}, 350000]}
  ]},
  "fixtures": [
    {"facts": {"current_class": 8, "school_type": "govt", "family_income_inr": 200000}, "expected": "eligible"}
  ]
}
```

The evaluator knows when a fact is missing. If the answer depends on it, the student sees "need more info" with the exact detail to provide.

## Check your changes

```bash
python scripts/validate_kb.py          # unknown IDs, sectors, broken rules, failing fixtures
python scripts/gen_golden.py           # if anything used by the engine changed
python -m pytest apps/api/tests -q
npm test
```

To change the demo scope (which skills have questions and checklists), see [docs/SCOPE.md](../../docs/SCOPE.md) first.
