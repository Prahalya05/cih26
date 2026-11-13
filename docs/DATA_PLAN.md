# Disha data plan: 2 days (trimmed)

The original targets (120 careers, 40 schemes, 60 courses, 25 apprenticeships) are weeks of work.
These targets are enough for a believable demo and can be done in 2 days by 3 people.

| Dataset | Have now | 2-day target | To add | Owner | Time |
|---|---|---|---|---|---|
| Careers (`packages/kb/occupations.json`) | 16 | **40** (5 per sector) | 24 | Careers lead + 1 helper | ~15 min each, 1 day for two people |
| Skills with Tamil names (`skills.json`) | 25 | **35** | 10 | Careers lead | 2 hours |
| Schemes + opportunities (`schemes.json` + `rules/`) | 9 | **18** | 9 | Schemes lead | ~40 min each (read official page, write rule + 2 examples) |
| Courses | separate dataset planned | **none** | 0 | — | Course names and links go inside each career's `pathway` steps |
| Picture cards with Tamil audio | 0 | **18** (3 per RIASEC letter) | 18 | Voice / design person | 1 day (free icons + record audio on a phone) |

Dropped for now: separate course and exam datasets, apprenticeship listings beyond NAPS and PM Internship,
mentor and employer records. Put them on the roadmap slide.

## Rules for every record

- Must have a `source_url` to an official or reputable page. Keep `"needs_verification": true` until a second person checks it.
- Scheme rules decide eligibility, not the AI, so income limits, ages and classes must come from the current year's official page.
- Every rule file needs at least 2 `fixtures`: one student who qualifies and one who doesn't.
- Use only the sectors in `kb.SECTORS` and skill ids that exist in `skills.json`.
- After any change, run the checks:

```
python scripts/gen_golden.py
python -m pytest apps/api/tests -q
cd packages/engine && npm test
```

The tests catch unknown skills, unknown sectors, schemes without rules and rules that fail their own examples.

## Careers to add (24), picked for rural Tamil Nadu

Coimbatore and western TN angle: textiles, pumps and motors, foundries, poultry, coconut.

| Sector | Have | Add |
|---|---|---|
| vocational | sewing machine operator, electrician, two-wheeler mechanic | CNC machine operator, welder / fabricator, pump & motor technician, mobile phone repair technician |
| agri | dairy entrepreneur, agri drone operator | organic farmer / FPO member, poultry farm supervisor, nursery & horticulture worker |
| creative | fashion designer, graphic designer, content creator | photographer / videographer, handloom & textile designer |
| services | bank correspondent, cook / chef | retail sales associate, hotel front office, warehouse & logistics executive, beautician |
| govt | primary teacher, police constable | TNPSC Group 4 / VAO, Agniveer (Army), Gramin Dak Sevak (post office) |
| health | nurse (ANM) | medical lab technician (DMLT), pharmacy assistant, physiotherapy assistant |
| entrepreneurship | boutique owner | e-Sevai / Common Service Centre operator, tiffin & catering business |
| stem | textile technician, software developer | civil site supervisor (diploma), data analyst |

## Schemes and opportunities to add (9)

Check each on its official page for the current year before writing the rule.

1. Central Sector Scholarship for college students (scholarships.gov.in)
2. PM YASASVI pre/post-matric for OBC, EBC and DNT students
3. Pre/post-matric scholarships for minority students
4. Tamil Nadu post-matric scholarship for BC / MBC students
5. Tamil Nadu first-graduate fee concession
6. Tamil Nadu 7.5% reservation for government school students in professional courses
7. PMKVY short-term skill training (Skill India Digital Hub)
8. DDU-GKY placement-linked training for rural youth
9. INSPIRE scholarship (SHE) for top science students

## Order of work

**Day 1:** careers and skills (two people), first 5 schemes (one person), card list and icons (one person).
**Day 2:** last 4 schemes, Tamil names checked by a native speaker, second-person verification pass, record card audio, run the checks.
