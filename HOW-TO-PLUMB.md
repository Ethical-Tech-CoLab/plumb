# How to Plumb

**A field guide for measuring buildings with your phone.**

📱 **The app: <https://ethical-tech-colab.github.io/plumb/>** — open it on your phone, no install
needed.

No experience needed. If you can take a photo, you can do this. About **15 minutes** to read, about
**10 minutes** for your first real capture.

> **What you're actually doing:** taking photographs that can be *measured from* — and proving where,
> when and by whom they were taken. A photo alone can't tell anyone how wide that window is. A photo
> with a **ruler of known size in the frame** can. That's the whole trick.

---

## Contents

1. [Before you go](#1-before-you-go)
2. [Printing and measuring your target card](#2-printing-and-measuring-your-target-card)
3. [At the building: safety first](#3-at-the-building-safety-first)
4. [Step 1 — Pick your wall](#step-1--pick-your-wall)
5. [Step 2 — Put the target on the wall](#step-2--put-the-target-on-the-wall)
6. [Step 3 — Stand in the right place](#step-3--stand-in-the-right-place)
7. [Step 4 — Take the pair of photos](#step-4--take-the-pair-of-photos)
8. [Step 5 — Calibrate](#step-5--calibrate)
9. [Step 6 — Check your work](#step-6--check-your-work-dont-skip-this)
10. [Step 7 — Measure](#step-7--measure)
11. [Step 8 — Save and upload](#step-8--save-and-upload)
12. [The one big trap](#the-one-big-trap)
13. [Common mistakes](#common-mistakes)
14. [Quick reference card](#quick-reference-card)
15. [Glossary](#glossary)

---

## 1. Before you go

### What you need

| Essential | Why | Cost |
|---|---|---|
| **An Android phone** (Chrome) | Plumb works best here — it can take full-resolution photos and lock the camera settings | you have one |
| **A printed target card** | The "ruler" that goes in the photo. [A4](docs/assets/target-a4.svg) or [US Letter](docs/assets/target-letter.svg) — see [section 2](#2-printing-and-measuring-your-target-card) | ~$1 |
| **A steel rule** | To measure your printed card, and to check your work. A steel rule, not a tape — see [why](#step-4--how-to-measure-well) | ~$10 |
| Nice to have: **a second known length** | Something on the building you can measure by hand, for checking | free |
| Nice to have: **stiff card or foam board** | To glue the target to, so it cannot bend | ~$5 |

iPhone works too, but with fewer features — Plumb will tell you which mode you're in.

### ⚠️ Print your target, then MEASURE it

This is the single most common beginner mistake, and it gets its own section — read
[the next one](#2-printing-and-measuring-your-target-card) before you print anything.

---

## 2. Printing and measuring your target card

### Download the card

| Paper | File |
|---|---|
| **A4** (most of the world) | **[target-a4.svg](docs/assets/target-a4.svg)** |
| **US Letter** (US, Canada) | **[target-letter.svg](docs/assets/target-letter.svg)** |

Both cards have **identical target geometry** — nominally **150.0 × 100.0 mm** — so it doesn't matter
which you use. Only the page layout differs.

### This is what the card looks like

The four corners are **checkerboard squares**. The point where the black and white squares meet is
called a *saddle point*, and it's the whole reason the card is designed this way: it is the single
most precisely locatable mark you can print. You can see it exactly by eye, and software can find it
to a fraction of a pixel. **That point is what you tap, and what you measure between.**

```
   ██▒▒                                    ▒▒██
   ██▒▒ ①                              ② ▒▒██          ① ② ③ ④  = tap order
   ▒▒██                                    ██▒▒
        ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
        │                                 │
        │  |<───── WIDTH ~150 mm ─────>|  │
        │                                 │
        │           HEIGHT ~100 mm        │
        │                                 │
        └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
   ██▒▒                                    ▒▒██
   ██▒▒ ④                              ③ ▒▒██
   ▒▒██                                    ██▒▒

   ↑ measure corner-to-corner between the points
     where black meets white — NOT the paper edge
```

The real card also carries the measuring instructions, boxes to write your measurements in, and a
100 mm bar for checking your printer.

### Step 1 — Print at 100%

In the print dialog:

- **Scale: 100%** or **"Actual size"**
- ❌ Turn **off** "Fit to page", "Shrink to fit", "Scale to fit media"
- Plain white paper is fine. Matte beats glossy — glossy reflects and hides the corners.

### Step 2 — Check the printer didn't lie

The card has a **100 mm bar** printed at the bottom. Measure it.

- **Reads 100 mm?** Your printer is accurate. Carry on.
- **Reads 97 mm?** Your printer scaled to 97%. **That's completely fine** — you're about to measure
  the real card anyway. This is exactly why the app never assumes the nominal size.

> Printers routinely scale by 1–3% because of margins, driver defaults and "fit to page". If you
> typed 150 mm when the card actually printed at 145.5, **every measurement you take would be 3%
> wrong** — a 3 m wall would read 3.09 m — and nothing on screen would look wrong.

### Step 3 — Measure what to measure

![What exactly to measure](docs/assets/07-what-to-measure.svg)

**Measure between the saddle points** — the exact spots where black touches white. These are the
same four points you'll tap in the app, which is what makes the measurement meaningful.

| ✅ Measure this | ❌ Not this |
|---|---|
| Where black meets white at each corner | The outer corner of the black squares |
| Point ① to point ② for the width | The edge of the paper |
| Point ① to point ④ for the height | The dashed guide rectangle |

Take **four** measurements and write them in the boxes on the card:

| Measurement | Between | Nominal |
|---|---|---|
| **Width** | ① → ② | ~150 mm |
| **Height** | ① → ④ | ~100 mm |
| **Diagonal A** | ① → ③ | ~180.3 mm |
| **Diagonal B** | ② → ④ | ~180.3 mm |

**The diagonals are a squareness check.** If they differ by more than about 1 mm, the print came out
skewed — reprint it. You only need to enter width and height into the app; the diagonals just prove
the card is square.

### Step 4 — How to measure well

- **Use a steel rule, not a tape measure.** A tape has a sliding hook at the end and sags across a
  span — both introduce a millimetre or two. A steel rule doesn't.
- **Read to the nearest 0.5 mm.** That's about 0.3% on a 150 mm card, which is well inside the error
  budget. Better instruments buy you very little here.
- **Lay the rule flat on the card**, look straight down at it. Reading at an angle introduces
  parallax error.
- **Measure twice.** If the two readings disagree, measure a third time.

### Step 5 — Make it last

- **Glue it to stiff card or foam board.** A bending target is a wrong target — a card that bows by a
  few millimetres in the middle throws the corners out of plane.
- **Write the measured numbers on the back**, with the date. You'll need them at every site.
- **Re-measure if it gets damp or warped.** Paper genuinely moves with humidity — a card left in a
  wet bag overnight is no longer the card you measured.
- Give each card an **ID** (`SB-001`) if you make several, so you always know which numbers go with
  which card.

### No printer? Use the building

You don't strictly need a printed card. Anything flat with a known size works:

- A window opening or door you've measured with a tape
- A standard brick course — measure ten courses and divide
- A panel, sign or tile of known dimensions

Same rule applies: **measure between the exact points you're going to tap.**

---

## 3. At the building: safety first

**No photograph is worth an injury or a citation.**

- Stay on public sidewalks unless you have permission to be on private property.
- Never step into a roadway, bike lane, or rail corridor to get a shot. Back up onto the sidewalk.
- Watch for traffic while you're looking at your screen. Look up often.
- Don't block doorways, ramps, or pedestrian flow.
- If someone asks what you're doing: you're photographing the building for a preservation record.
  Be friendly. If they ask you to stop, stop.
- Some landmark sites need permits for tripods or commercial work. Check first.

---

## Step 1 — Pick your wall

Plumb measures **one flat surface at a time**. Pick the wall you care about — say, the brick face of
the front of the building.

Write it down in the app ("north facade, brick face, ground floor"). This matters later, because
everything you measure will be accurate *on that surface* and less accurate off it.

**Good surfaces to start with:** a flat brick or stone wall, a plain facade, a door, a shopfront.

**Save for later:** heavily carved surfaces, deep porches, anything with lots of things sticking out.

---

## Step 2 — Put the target on the wall

![Where to put the scale target](docs/assets/02-target-placement.svg)

Put your printed target **flat against the wall you're measuring**, roughly in the middle of the area
you care about.

- ✅ Taped flat to the brick face
- ✅ Propped square against the wall, not tilted
- ❌ Held in your hand, at an angle
- ❌ Stuck on a cornice, sill, or anything that sticks out from the wall (see [the one big trap](#the-one-big-trap))

**No target?** You can also use something on the building whose size you've measured by hand — a
standard door, a window opening, a panel. Measure it with your tape first, then use it as the target.
This is also how you can measure from **old archival photographs** later.

---

## Step 3 — Stand in the right place

![Where to stand](docs/assets/01-where-to-stand.svg)

**Stand square on.** Directly in front of the wall, camera pointing straight at it — not off to one
side, not tilted up or down.

Plumb *can* correct for shooting at an angle, and it will show you a grid that visibly bends when
you're off-square. But the closer to square you are, the better the result.

- **Best:** straight on, 90° to the wall
- **OK:** up to about 30° off
- **Re-shoot:** beyond about 45° — the target gets too squashed to read accurately

Stand back far enough that the whole area you want fills the frame.

**Watch the level bar at the top of the screen.** Keep pitch and roll under 3°. Plumb warns you when
you're off-plumb.

---

## Step 4 — Take the pair of photos

Plumb takes **two photos from the same spot**:

1. **With the scale** — your target clearly visible in the frame.
2. **Clean** — the same view with the target removed.

Why two? Because the official documentation standard (HABS, used for US landmark records) *requires* a
photo with a scale in it. But you also want a clean photograph of the building for design work and
visual records. So Plumb gives you both.

**Before you press the button:**

- Tap **Lock focus + exposure**. This keeps the camera's settings steady, which makes the measurements
  more reliable. (On Android — Plumb hides this if your phone doesn't support it.)
- Keep zoom at 1.0×. Zooming breaks the calibration.
- Brace your elbows against your body. Breathe out. Then tap.
- Use **Full-res photo**, not "Freeze preview frame" — the preview is lower quality.

![Good shot vs bad shots](docs/assets/03-good-vs-bad.svg)

---

## Step 5 — Calibrate

"Calibrating" just means telling Plumb how big things really are.

![Corner tapping order](docs/assets/04-corner-order.svg)

1. Enter your target's **measured** width and height — the numbers you wrote on the back of the card
   in [section 2](#2-printing-and-measuring-your-target-card), not the nominal 150 × 100.
2. Tap **Pick 4 corners**.
3. Tap the **saddle points** — where black meets white — **clockwise starting from top-left**:
   ① top-left → ② top-right → ③ bottom-right → ④ bottom-left.
4. Tap **Solve calibration**.

**Zoom in before you tap.** A few pixels of sloppiness here turns into millimetres of error later.

You'll see a badge appear: **CAL-3 · UNVERIFIED**. That means Plumb knows the scale but hasn't proved
it's right yet. That's the next step.

### Turn on the grid

Now tap **Metric grid**. You'll see a grid appear, in real-world sizes — 100 mm squares, or 1 foot, your
choice.

On an angled photo the grid will look like it converges into the distance. **That's correct.** That's
what a real grid looks like in perspective, and it's your visual proof that Plumb understands the
geometry of the shot.

Tap **Grid off** whenever you want to see the clean photo. The grid is never baked into your original
image.

---

## Step 6 — Check your work (don't skip this)

![The hold-out check](docs/assets/05-holdout-check.svg)

This is the step that separates a real measurement from a guess.

**Measure something you already know, that you did NOT use to calibrate.**

1. Pick something on the wall you can measure with a tape — a window width, a door, ten brick courses.
2. Measure it by hand. Write it down.
3. In Plumb: enter that known length, tap **Pick check points**, and tap the two ends in the photo.

Plumb compares its answer to your known length:

- **VERIFIED** ✅ — within tolerance. Your measurements are trustworthy.
- **FAILED** ❌ — something's wrong. Plumb **blocks measuring** until you fix it.

> **Why it matters:** if you only check your calibration against the same target you calibrated with,
> you've proved nothing — of course it agrees with itself. An *independent* check is the only way to
> know it actually works.

**If your check fails**, work through this list:

| Check | Fix |
|---|---|
| Did you type the *measured* target size? | Re-measure the card with a steel ruler |
| Was the target flat on the wall? | Re-shoot with it flat |
| Did you tap the corners accurately? | Zoom in and redo the corner picks |
| Is your check length on the same flat surface? | Pick a different check feature |
| Was your hand-measurement right? | Re-measure it |

**Two checks are better than one** — one horizontal, one vertical. That catches errors a single check
would miss.

---

## Step 7 — Measure

Tap **Measure distance**, then tap the two points you want the distance between.

You get something like:

```
window head width     1220.4 ± 4.1 mm (95%)
tier CAL-3 · calibration VERIFIED · USIBD LOA30
```

### How to read that

| Part | Meaning |
|---|---|
| **1220.4 mm** | The measurement |
| **± 4.1 mm (95%)** | The honest error range. The true value is almost certainly within 4.1 mm either way |
| **CAL-3** | How it was calibrated (higher = better) |
| **VERIFIED** | Your check passed |
| **LOA30** | The professional accuracy grade this meets |
| **PROVISIONAL** | This is the on-phone estimate. The final number comes from the server later, and will be better |

**Never write down the number without the ± range.** A measurement without its uncertainty isn't a
measurement — it's a claim. Plumb won't let you export one without it, and neither should you.

---

## Step 8 — Save and upload

### What gets saved

| File | What it is |
|---|---|
| **Raw image** | Your original photo, completely untouched. No grid drawn on it, not re-compressed |
| **Overlay** | The grid and measurements, as a separate layer |
| **Annotated derivative** | Photo + grid combined, for reports |
| **Provenance sidecar** | A file recording where, when, with what, by whom — and honestly listing what it does *not* prove |

The original is **never** modified. Everything else can be regenerated; the original can't.

### Uploading — Wi-Fi only by default 📶

Full-resolution photos are big. A day's fieldwork can be several gigabytes, so **Plumb will not upload
over cellular data unless you tell it to.**

| Setting | What it does |
|---|---|
| **Wi-Fi only** *(default)* | Nothing is sent over cellular. Ever |
| **Wi-Fi preferred** | Uses fast cellular (4G/5G) if there's no Wi-Fi |
| **Any network** | Uploads on anything. Watch your data plan |
| **Manual only** | Nothing uploads until you tap the button |

**Nothing is lost while you wait.** Your captures sit safely in a queue on the phone and upload
automatically the moment you're on Wi-Fi. Because the real measuring happens later on the server
anyway, waiting costs you nothing.

If your phone's **Data Saver** is on, Plumb holds uploads regardless of the setting.

> ⚠️ **Before you finish for the day:** if the queue is large, connect to Wi-Fi and let it drain, or use
> the export button to save a local copy. Phone browsers can clear storage when space runs low.

---

## The one big trap

![The off-plane trap](docs/assets/06-off-plane-trap.svg)

**Plumb is only exact on the surface you calibrated.**

If you calibrate on the brick wall and then measure a cornice that sticks out 600 mm, your answer will
be wrong — and it will *look* completely fine. From 15 m away, that cornice can read about **24 mm
off**, which is larger than the entire error budget.

**What to do:**

1. **Just measure things on the wall.** Simplest and safest.
2. **Tell Plumb the depth.** If you know the cornice sticks out 600 mm, type it into "Depth off plane"
   and Plumb widens the error range honestly.
3. **Calibrate a second plane** on the cornice itself.
4. **Shoot a full set** of overlapping photos and let the server build a 3D model.

If you remember nothing else from this guide, remember this one.

---

## Common mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Printing with "fit to page" | Card is 1–3% wrong, so everything is | Print at 100%, then check the 100 mm bar |
| Typing the nominal 150 × 100 | Silently wrong by however much your printer scaled | Type your **measured** numbers |
| Measuring to the paper edge | Wrong by ~12 mm — an 8% error | Measure saddle to saddle, black-meets-white |
| Card held in hand, tilted | Bad calibration | Tape it flat to the wall |
| Card bent or bowed | Corners fall out of plane | Glue it to stiff board |
| Skipping the check | You never find out it's wrong | Always do a hold-out check |
| Checking against your own target | Proves nothing | Use a *different* known length |
| Measuring things that stick out | Silently wrong | See [the one big trap](#the-one-big-trap) |
| Using zoom | Breaks calibration | Keep zoom at 1.0×, walk closer instead |
| Card tiny in the frame | Large errors | Get closer, or print a bigger target |
| Card at the edge of the frame | Lens distortion | Keep it near the centre |
| Shooting into the sun / deep shadow | Corners can't be found | Shoot with even light. Overcast is ideal |
| Writing down a number without its ± | Not a measurement any more | Always carry the uncertainty |

---

## Quick reference card

*Print this and keep it in your bag.*

```
┌─────────────────────────────────────────────────────┐
│  PLUMB — FIELD CARD                                 │
├─────────────────────────────────────────────────────┤
│  BEFORE YOU GO                                      │
│   □ Card printed at 100% (NOT "fit to page")        │
│   □ 100 mm check bar verified with a steel rule     │
│   □ Width + height MEASURED saddle-to-saddle        │
│     (where black meets white — not the paper edge)  │
│   □ Diagonals agree within ~1 mm                    │
│   □ Numbers written on the back, card on stiff board│
│   □ Steel rule + tape packed, phone charged         │
│                                                     │
│  AT THE WALL                                        │
│   □ Safe spot, on the sidewalk                      │
│   □ Card FLAT on the wall you're measuring          │
│   □ Stand SQUARE ON, level bar under 3°             │
│   □ Zoom = 1.0×, lock focus + exposure              │
│   □ Full-res photo — with scale, then clean         │
│                                                     │
│  IN THE APP                                         │
│   □ Type the MEASURED size, not 150 × 100           │
│   □ Tap saddles: ①TL → ②TR → ③BR → ④BL (zoom first) │
│   □ Solve calibration                               │
│   □ HOLD-OUT CHECK ⇒ must say VERIFIED              │
│   □ Measure. Keep the ± with every number           │
│                                                     │
│  BEFORE YOU LEAVE                                   │
│   □ Queue uploaded, or exported locally             │
│                                                     │
│  REMEMBER: accurate only ON the calibrated surface. │
└─────────────────────────────────────────────────────┘
```

---

## Glossary

| Term | Plain English |
|---|---|
| **Calibration** | Telling Plumb how big things really are, using something of known size |
| **Target / calibration card** | The printed pattern you put in the photo so it can be measured |
| **Saddle point** | The point where the black and white squares touch. The most precisely locatable mark you can print — it's what you tap and what you measure between |
| **Nominal vs measured** | *Nominal* is the size the card was designed to be (150 × 100 mm). *Measured* is what actually came out of your printer. Always use measured |
| **Hold-out check** | Measuring something you already know, to prove the calibration works |
| **Plane** | The flat surface you're measuring — usually a wall face |
| **Off-plane** | Anything sticking out from that surface. Measured less accurately |
| **CAL-0 … CAL-5** | How good your calibration is. CAL-0 = no measuring allowed. CAL-3 = normal good practice |
| **± 4.1 mm (95%)** | The honest error range — 95% confident the truth is within it |
| **LOA** | Professional accuracy grade (USIBD). LOA30 ≈ 6 mm, LOA20 ≈ 15 mm |
| **PROVISIONAL** | The quick on-phone answer. The server produces the final, better one |
| **Provenance** | The record of where, when, how and by whom a photo was taken |
| **Orthophoto** | A photo mathematically flattened so it's like a scale drawing |
| **HABS** | The US national standard for recording historic buildings |

---

## What's next

- Curious how it works underneath? → [docs/02-calibration-methodology.md](docs/02-calibration-methodology.md)
- Want to contribute captures? → [CONTRIBUTING.md](CONTRIBUTING.md)
- Video walkthroughs → [docs/video-plan.md](docs/video-plan.md)

**Questions, or something in this guide unclear?** Open an issue. If a beginner got confused, the guide
is wrong, not the beginner.
