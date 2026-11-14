"""Builds docs/Disha_Pilot_Pack.docx (Step 12.2): pilot plan, headteacher letter, parent consent form, teacher rating sheet, student questions. Run from the repo root: python scripts/make_pilot_pack.py"""
import json
import glob
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

TA_FONT = "Nirmala UI"
BRAND = RGBColor(0x0F, 0x5E, 0x6E)

subs = {s["id"]: s for s in json.load(open("packages/kb/graph/subskills.json", encoding="utf-8"))}
tested = sorted({it["subskill"] for f in glob.glob("packages/kb/items/*.json")
                 for it in json.load(open(f, encoding="utf-8")) if "subskill" in it})
ORDER = ["ss_stitch_measure", "ss_stitch_cutting", "ss_stitch_machine", "ss_stitch_fitting",
         "ss_elec_safety", "ss_money_counting", "ss_money_pricing"]
assert sorted(ORDER) == tested, tested

doc = Document()
st = doc.styles["Normal"]
st.font.name = "Calibri"
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:cs"), TA_FONT)
for name, size in (("Title", 22), ("Heading 1", 16), ("Heading 2", 12.5)):
    s = doc.styles[name]
    s.font.name = "Calibri"
    s.font.size = Pt(size)
    s.font.color.rgb = BRAND
    s.element.rPr.rFonts.set(qn("w:cs"), TA_FONT)
    s.paragraph_format.keep_with_next = True
    s.paragraph_format.space_before = Pt(10)
    s.paragraph_format.space_after = Pt(4)

sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
for side in ("left_margin", "right_margin"):
    setattr(sec, side, Cm(2))
sec.top_margin = sec.bottom_margin = Cm(1.8)

cp = doc.core_properties
cp.author = "Disha"
cp.last_modified_by = "Disha"
cp.title = "Disha pilot pack"


def para(text="", bold=False, size=None, italic=False, after=4):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.bold, r.italic = bold, italic
    if size:
        r.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(after)
    return p


def bullets(items, style="List Bullet"):
    for t in items:
        p = doc.add_paragraph(t, style=style)
        p.paragraph_format.space_after = Pt(2)


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), hex_fill)
    tcPr.append(sh)


def table(rows, widths, header=True, size=9.5):
    t = doc.add_table(rows=len(rows), cols=len(widths))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            c = t.cell(i, j)
            c.width = Cm(widths[j])
            c.text = ""
            r = c.paragraphs[0].add_run(str(val))
            r.font.size = Pt(size)
            if header and i == 0:
                r.bold = True
                shade(c, "E3EFF1")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def line(label, length=60):
    para(f"{label} " + "_" * length, after=8)


# ---------------- Part A: plan ----------------
doc.add_paragraph("Disha pilot pack", style="Title")
para("Step 12.2 of the implementation plan. Everything needed to run the two-day school pilot: the plan and "
     "checklist, a letter asking the headteacher for permission, the parent consent form (Tamil and English), "
     "the teacher rating sheet and the student questions. Print parts C, D and E as many times as needed.",
     after=8)

doc.add_paragraph("A. Plan and checklist", style="Heading 1")
doc.add_paragraph("Who and where", style="Heading 2")
bullets([
    "One government or aided school. 60 students in Classes 9 to 12, and 2 teachers who know them well.",
    "Permission from the headteacher (letter in part B); ask whether the district education office must also agree.",
    "A facilitator runs the sessions; the teachers rate students on paper and do not see Disha's results.",
])
doc.add_paragraph("Before the pilot", style="Heading 2")
table([
    ["When", "What", "Done"],
    ["3 weeks before", "Meet the headteacher, hand over the letter (part B), agree dates and a room.", "☐"],
    ["2 weeks before", "Give each student two copies of the consent form (part C) to take home: one for the parent to keep.", "☐"],
    ["1 week before", "Collect signed forms. Give every student with a signed form a code (P01 to P60). "
                      "Write the code on the form; the form stays in a locked file with the facilitator.", "☐"],
    ["1 week before", "Prepare 10 phones (or family phones): install Disha, open it once online so all questions, "
                      "pictures and audio are stored, set the facilitator code, check the time and date.", "☐"],
    ["1 week before", "Give each teacher the rating sheet (part D) with the student codes filled in.", "☐"],
    ["Day before", "Charge phones and power banks; print the student questions (part E).", "☐"],
], [3.2, 12, 1.8])

doc.add_paragraph("Schedule", style="Heading 2")
table([
    ["Day", "Session (about 40 minutes per student)", "Notes"],
    ["Day 1", "Onboarding: new student with code and birth year, consent screen (choose the same options "
              "the parent ticked), interest cards, 2 questions by voice. Then 3 skill tests.",
     "Groups of 10, one phone each. Students under 18: method is the signed paper form."],
    ["Day 2", "The three aptitude games (about 9 minutes) and one work sample photo where it applies.",
     "No electrical work samples for under-18s: the app does not offer them."],
    ["Day 2", "Each student answers the three questions in part E on paper.", "Read the questions aloud in Tamil."],
    ["After 1 week", "Retest 20 students (codes P01 to P20) on 2 sub-skills they took on day 1.",
     "Same phones; the app treats it as a new session."],
], [2.4, 9.2, 5.4])

doc.add_paragraph("After the pilot", style="Heading 2")
bullets([
    "Sync every phone at the school (Wi-Fi or hotspot) until no event is waiting.",
    "Type the teacher sheets into teacher.csv with columns student_id, subskill_id, level (one row per rating; "
    "student_id is the app's id for that code, from the teacher screen).",
    "Type the student answers into survey.csv with columns student_id, easy, fun, careers_right (yes, no or unsure).",
    "Run: python scripts/pilot_report.py --teacher teacher.csv --survey survey.csv  (writes docs/PILOT_REPORT.md).",
    "Run: python scripts/calibrate.py and read the flagged questions with a teacher before running it again with "
    "--write. With 60 students about 1 in 20 good questions is flagged by chance.",
    "Shred the paper consent forms only when the school's retention rules allow; never copy names into the app or the CSV files.",
])
doc.add_paragraph("Targets", style="Heading 2")
table([
    ["Measure", "Target", "Note from the dry run"],
    ["Disha level vs teacher (weighted kappa)", "≥ 0.6", "0.76 on made-up students"],
    ["Within one level of the teacher", "≥ 80%", "97% on made-up students"],
    ["Same level on retest", "≥ 75%", "Not reachable by one short test alone: about 58-62% "
                                       "exact (97% within one level) even with 15 questions. Decide before the "
                                       "pilot whether to judge retest on the full Disha level or on within-one."],
], [6, 2.4, 8.6])

# ---------------- Part B: letter ----------------
page_break()
doc.add_paragraph("B. Letter to the headteacher", style="Heading 1")
para("Date: ____________", after=10)
para("To", after=0)
para("The Headteacher", after=0)
para("______________________________ (school)", after=0)
para("______________________________ (district)", after=10)
para("Subject: Permission for a two-day pilot of Disha, a career guidance app, in Classes 9 to 12", bold=True, after=10)
para("Respected Sir / Madam,")
for t in [
    "We request permission to try Disha with 60 students of Classes 9 to 12 in your school. Disha is a free "
    "Tamil and English phone app that helps students find what they are good at, careers that fit them, and "
    "scholarships and schemes they can apply for. It is built for the Citi India Hackathon.",
    "Each student uses the app for about 40 minutes on each of two days, in groups of ten, at a time that suits "
    "the school timetable. One week later, 20 students repeat two short tests. Two teachers are asked to rate "
    "the same students on paper, so that we can check whether the app agrees with teachers who know them.",
    "Parents are asked first, using a consent form in Tamil. A student takes part only if a parent has signed. "
    "Names are not stored in the app; students use a code. Voice recordings and photos are not kept on any "
    "server. A parent can withdraw at any time and all of the student's data is deleted.",
    "We will share the results with the school: how well the app's levels matched the teachers' ratings and "
    "what students said about it.",
]:
    para(t, after=6)
para("Thanking you,", after=24)
para("Signature: __________________________", after=4)
para("Name and organisation: __________________________", after=4)
para("Phone: __________________________", after=18)
para("Permission given / not given", bold=True, after=4)
para("Headteacher's signature and seal: __________________________     Date: ____________", after=4)

# ---------------- Part C: consent ----------------
page_break()
doc.add_paragraph("C. Parent consent form  /  பெற்றோர் ஒப்புதல் படிவம்", style="Heading 1")
para("Tamil wording to be checked by a native speaker before printing.", italic=True, size=9, after=6)
para("திசை (Disha) என்பது மாணவர்கள் தாங்கள் எதில் திறமையானவர்கள் என்பதையும், பொருத்தமான வேலைகளையும், "
     "உதவித்தொகைகளையும் கண்டறிய உதவும் ஒரு இலவச கைபேசி செயலி. உங்கள் பிள்ளை பள்ளியில் இரண்டு நாட்கள், "
     "ஒவ்வொரு நாளும் சுமார் 40 நிமிடங்கள் இதைப் பயன்படுத்துவார்.", after=4)
para("Disha is a free phone app that helps students find what they are good at, careers that fit, and "
     "scholarships. Your child will use it at school for about 40 minutes on each of two days.", italic=True, after=8)

doc.add_paragraph("எதற்கு ஒப்புக்கொள்கிறீர்கள் / What you agree to", style="Heading 2")
table([
    ["", "ஒப்புதல் / Consent", "✔"],
    ["1", "திசையைப் பயன்படுத்துதல் (தேவை): பதில்களும் சோதனை முடிவுகளும் சேமிக்கப்பட்டு ஆசிரியருடன் பகிரப்படும்.\n"
          "Use Disha (needed): answers and test results are saved and shared with the teacher.", "☐"],
    ["2", "புகைப்படச் சரிபார்ப்பு (விருப்பம்): உங்கள் பிள்ளையின் வேலையின் புகைப்படத்தை ஒரு கணினி நிரல் சரிபார்க்கும். "
          "புகைப்படம் எந்தச் சர்வரிலும் சேமிக்கப்படாது.\nPhoto checking (optional): a computer program checks a photo "
          "of your child's work. The photo is not kept on any server.", "☐"],
    ["3", "என் பிள்ளையின் வேலையைப் பகிர்தல் (விருப்பம்): ஆசிரியர்களும் வேலை தருபவர்களும் வேலை மாதிரிகளைப் பார்க்கலாம்.\n"
          "Share my child's work (optional): teachers and employers can see the work samples.", "☐"],
], [0.8, 14.4, 1.8], size=9.5)

doc.add_paragraph("உங்களுக்குத் தெரிய வேண்டியவை / Good to know", style="Heading 2")
bullets([
    "பெயர் செயலியில் சேமிக்கப்படாது; உங்கள் பிள்ளைக்கு ஒரு குறியீடு வழங்கப்படும். / The name is not stored in the app; your child gets a code.",
    "குரல் பதிவுகள் சேமிக்கப்படாது. / Voice recordings are not kept.",
    "எப்போது வேண்டுமானாலும் ஒப்புதலைத் திரும்பப் பெறலாம்; அனைத்துத் தரவும் நீக்கப்படும். / You can withdraw at any "
    "time; all data is then deleted.",
    "18 வயதுக்குக் கீழ் உள்ளவர்களுக்கு மின் வேலை மாதிரிகள் கேட்கப்படாது. / Students under 18 are never asked for electrical work samples.",
    "பங்கேற்பது கட்டாயமில்லை; பங்கேற்காததால் எந்தப் பாதிப்பும் இல்லை. / Taking part is voluntary; saying no has no effect on your child.",
])
para("", after=6)
line("மாணவர் பெயர் / Student's name:", 45)
line("வகுப்பு / Class:  ______      பிறந்த ஆண்டு / Year of birth:", 20)
line("பெற்றோர் / பாதுகாவலர் பெயர் / Parent or guardian's name:", 30)
line("உறவு / Relationship:  ____________     கையெழுத்து / Signature:", 22)
line("தேதி / Date:", 20)
para("For the facilitator: student code P____   (write the same code in the app; keep this form in a locked file)",
     italic=True, size=9, after=2)

# ---------------- Part D: teacher sheet (landscape) ----------------
new = doc.add_section()
new.orientation = WD_ORIENT.LANDSCAPE
new.page_width, new.page_height = Cm(29.7), Cm(21)
new.left_margin = new.right_margin = Cm(1.5)
new.top_margin = new.bottom_margin = Cm(1.5)
doc.add_paragraph("D. Teacher rating sheet", style="Heading 1")
para("Rate each student from what you have seen them do, before and without looking at Disha's results. "
     "Write 1, 2, 3 or 4 for each skill, or leave it blank if you do not know. Use student codes only, no names.",
     after=6)
key = [["Skill / திறன்", "1", "2", "3", "4"]]
for u in ORDER:
    s = subs[u]
    key.append([f"{s['name']['en']} / {s['name']['ta']}"] + [s["levels"][k]["en"] for k in "1234"])
table(key, [5.2, 5.3, 5.3, 5.3, 5.3], size=8.5)
para("Teacher code: ________     Date: ____________", after=6)
head = ["Student code"] + [subs[u]["name"]["en"] for u in ORDER]
rows = [head] + [[f"P{n:02d}"] + [""] * len(ORDER) for n in range(1, 31)]
table(rows, [2.6] + [3.4] * len(ORDER), size=8.5)
para("Continue on a second copy for P31 to P60.", italic=True, size=9)

# ---------------- Part E: student questions (portrait) ----------------
last = doc.add_section()
last.orientation = WD_ORIENT.PORTRAIT
last.page_width, last.page_height = Cm(21), Cm(29.7)
last.left_margin = last.right_margin = Cm(2)
last.top_margin = last.bottom_margin = Cm(1.8)
doc.add_paragraph("E. Student questions  /  மாணவர் கேள்விகள்", style="Heading 1")
para("Cut along the lines; one slip per student. Read the questions aloud in Tamil.", italic=True, size=9, after=6)
for _ in range(4):
    table([
        ["Student code: P____", "ஆம் / Yes", "இல்லை / No", "தெரியவில்லை / Not sure"],
        ["1. இது எளிதாக இருந்ததா? / Was it easy?", "☐", "☐", "☐"],
        ["2. இது மகிழ்ச்சியாக இருந்ததா? / Was it fun?", "☐", "☐", "☐"],
        ["3. காட்டப்பட்ட வேலைகள் உங்களுக்குப் பொருத்தமாகத் தோன்றுகின்றனவா? / Do the careers feel right for you?", "☐", "☐", "☐"],
    ], [9.4, 2.4, 2.4, 2.8], size=9.5)
    para("✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", size=8, after=6)

doc.save("docs/Disha_Pilot_Pack.docx")
print("saved")
