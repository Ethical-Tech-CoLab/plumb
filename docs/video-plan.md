# Video plan — Plumb field capture

Storyboards and production notes for short instructional videos. Written so someone with a phone and
a free afternoon can shoot them; nothing here needs a studio.

**Status:** planned. The still diagrams in [`assets/`](assets/) are the interim substitute and double
as storyboard frames.

---

## Principles

1. **Shortest useful length.** A volunteer watches a 90-second clip on the sidewalk. They do not
   watch nine minutes.
2. **Show the mistake first, then the fix.** People remember the failure they recognise.
3. **Real building, real weather, real phone.** A studio mock-up teaches nothing about glare, traffic
   or a target that won't stay flat.
4. **Caption everything.** Field video gets watched muted, outdoors, in bright sun.
5. **Show the numbers on screen.** When the check reads `0.25% — VERIFIED`, that is the moment the
   idea lands.

---

## V1 — "Your first measurement" (2:30) · priority 1

The one video that matters. Someone watches this and can go do it.

| # | Shot | Duration | Voiceover / caption |
|---|---|---|---|
| 1 | Phone photographing a brick facade, target taped to wall | 0:10 | "A photo can't tell you how wide that window is. A photo with a ruler in it can." |
| 2 | Close-up: printing the target, then **measuring it with a steel rule** | 0:20 | "Printers lie. Measure what came out, write it on the back." |
| 3 | Taping the target flat to the wall | 0:15 | "Flat, on the surface you want to measure." |
| 4 | Walking to stand square on; level bar on screen going green | 0:20 | "Stand square on. Watch the level." |
| 5 | Screen recording: tapping 4 corners TL→TR→BR→BL, zoomed in | 0:25 | "Tap the corners. Zoom in — sloppy here, wrong later." |
| 6 | Metric grid appears and converges on an angled shot | 0:15 | "The grid bends because the wall is at an angle. That's it working." |
| 7 | Tape-measuring a window, entering it as the check | 0:25 | "Now prove it. Measure something you already know." |
| 8 | Status flips to **VERIFIED**, error 0.25% | 0:10 | "Verified. Now your measurements mean something." |
| 9 | Taking a measurement; result shows `1220.4 ± 4.1 mm (95%)` | 0:20 | "Always keep the ± . A number without it isn't a measurement." |
| 10 | Upload panel showing "Wi-Fi only — holding" | 0:10 | "It waits for Wi-Fi. Nothing is lost." |

---

## V2 — "The five mistakes" (1:45) · priority 2

Fast cuts. Each mistake shown wrong, then right.

| Mistake | Wrong | Right |
|---|---|---|
| Trusting the printed size | typing "200" straight from the print dialog | steel rule reading 197.5, typed in |
| Target held in hand | tilted, hand-held, wobbling | taped flat |
| Skipping the check | tapping past it, measuring on UNVERIFIED | doing the check, VERIFIED |
| Measuring a cornice | measuring the projecting cornice on a wall calibration | entering depth, or second plane |
| Using zoom | pinch-zooming to frame | walking closer |

Close on: *"Every one of these looks fine on screen. That's why the check exists."*

---

## V3 — "Why the cornice lies" (1:15) · priority 3

The single conceptual idea worth its own video, because it's the one that silently corrupts data.

- Animated section view (reuse [`06-off-plane-trap.svg`](assets/06-off-plane-trap.svg)).
- Live demo: measure a cornice from a wall calibration, then measure it with a tape. Show the gap.
- Three fixes: declare depth · second plane · full photo set for 3D.

---

## V4 — "A full facade in ten minutes" (4:00) · priority 4

Unedited-feel walkthrough of a complete DUMBO facade session: arrive, assess, place, shoot the pair,
calibrate, check, measure a set, queue, leave. Shows pacing and that it's genuinely quick.

---

## V5 — "Re-shooting a historic viewpoint" (2:00) · priority 5

X-Ray mode: load a HAER NY-18 Brooklyn Bridge frame, line the live view up with the historic
photograph, capture the modern match. Strong story, and it demonstrates change monitoring.

---

## Production notes

**Kit:** two phones (one shoots, one is the subject), a small tripod, a lav mic or a quiet morning,
the printed target set, a steel tape.

**Conditions:** bright overcast. Harsh sun blows out the target and hides facade detail — the same
reason it's bad for capture is the reason it's bad on camera.

**Screen recording:** Android built-in recorder at 1080p60. Record the phone screen separately and cut
between hand-held context and screen capture; don't film the screen.

**Accessibility:** burned-in captions, described visuals in the voiceover ("the badge turns green"),
transcript in the repo next to each video, no red/green-only signalling.

**Licence:** CC BY 4.0, same as the rest of the content. Host on the CoLab channel; keep source files
and transcripts in the repo so they can be re-cut.

**Do not film:** identifiable passers-by as subjects, building interiors, anything requiring an unsafe
position. The video is also a demonstration of good field conduct — if the presenter steps into the
road, the guide is worthless.
