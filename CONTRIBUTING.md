# Contributing to Plumb

Plumb produces **evidence**. A measurement is only as trustworthy as the person and process that
produced it, so contribution here works a little differently from a typical open-source project:
**code is open to everyone; measured captures are gated.**

---

## Two kinds of contribution

### 1. Code, documentation and research — open

Normal open-source flow. Open an issue, discuss, send a pull request.

- Code is **Apache-2.0**. By contributing you agree your contribution is licensed under it.
- Keep the geometry core ([`prototype/lib/geometry.js`](prototype/lib/geometry.js))
  **dependency-free**. It is the part that has to be portable and auditable.
- **Metrology changes require tests.** Anything touching calibration, measurement or uncertainty must
  come with unit tests validating against synthetic ground truth:

  ```bash
  node --test prototype/test/geometry.test.mjs
  ```

- **Uncertainty models must be validated, not asserted.** This is a hard rule, learned the hard way:
  the first uncertainty model in this repo looked reasonable and gave only **89.1 % coverage** where
  95 % was claimed. If you add or change an error model, add a Monte-Carlo test proving its stated
  interval actually brackets true error at the stated rate. A model that under-reports uncertainty is
  worse than no model, because it launders a guess into a number with a ± on it.
- Don't add build steps or dependencies to the prototype without discussion.

### 2. Measured captures — gated

Photographic and measurement contributions go through contributor vetting and curation before
publication. This is deliberate and is the project's core quality mechanism, not gatekeeping for its
own sake.

**Contributor tiers**

| Tier | Who | What their submissions carry |
|---|---|---|
| `public` | Anyone approved to submit | Accepted, tier-labelled, needs corroboration |
| `trained` | Completed the capture training | Higher default trust, eligible for more subjects |
| `professional` | Licensed surveyor / architect / engineer, credential verified | Eligible for `CAL-5` and sign-off workflows |

**Every submission carries, and cannot shed:**

- its **calibration tier** (`CAL-0`…`CAL-5`) and calibration status (`UNVERIFIED` / `VERIFIED` / `FAILED`);
- its **uncertainty**, reported as `value ± 2σ (95 %)`, never as a bare number;
- its **provenance sidecar** — device, capture profile, sensors, operator, subject, hashes;
- an explicit statement of what it does **not** prove.

**Non-negotiables for capture contributions**

1. **A physical scale must be in frame.** Required by the SOI/HABS standard and by our own metrology.
2. **The raw image is never modified.** No overlays burned in, no re-encoding, no "cleanup." Overlays
   are separate artifacts.
3. **A hold-out check is mandatory.** A calibration verified only against the points used to fit it is
   not verified. No check ⇒ `UNVERIFIED`.
4. **Never present a `CAL-0` or `FAILED` measurement as a measurement.** The tooling enforces this;
   don't work around it.
5. **Nothing is measured outside its calibrated plane** without a declared depth offset.
6. **Safety and legality first.** No trespass, no obstructing roadways or rail, respect site rules and
   permits. No photograph is worth an injury or a citation.

---

## Licensing of contributions

| What you contribute | Licence | Why |
|---|---|---|
| Code | **Apache-2.0** | Permissive with an explicit patent grant |
| Documentation | **CC BY 4.0** | |
| Photographs and derived imagery | **CC BY 4.0** | Lets preservation architects and engineers actually use it in real (often proprietary) deliverables |
| Measurement data and metadata | **CC0 1.0** | Measurements are facts; CC0 removes ambiguity for institutional adopters |

You must own the rights to what you submit, or have permission to license it this way.

**We deliberately do not use share-alike.** Reasoning is in
[docs/06-trust-anchor-and-licensing.md](docs/06-trust-anchor-and-licensing.md) §3 — in short, it would
require architects to open-source their client deliverables, which would simply stop them using the
corpus at all.

**Important consequence:** because the corpus is CC BY, we **cannot accept CC BY-SA material**
(e.g. Wikimedia Commons, Mapillary) into it. Such material must live in a separately-licensed,
separately-tagged collection. Please flag the source and licence of anything you did not capture
yourself.

## Privacy and people

- Avoid photographing identifiable people where you reasonably can; the subject is the building.
- Faces and licence plates are blurred on public-facing derivatives.
- Don't photograph building interiors through windows.

## Reporting problems

- **A wrong measurement in the corpus** — open an issue with the capture ID. Corrections are additive:
  we don't delete history, we supersede it.
- **A security or key-handling issue** — do not open a public issue; contact the maintainers directly.

## Ethos

Three principles, in priority order:

1. **Be honest about uncertainty.** Every number gets an error bar and a provenance trail. "About a
   metre" stated honestly beats "1000 mm" stated falsely.
2. **The raw record is sacred.** Everything else can be regenerated; the original exposure cannot.
3. **Claim only what you can show.** Provenance proves the pipeline, not the scene. Calibration proves
   the plane, not the cornice. Say so.
