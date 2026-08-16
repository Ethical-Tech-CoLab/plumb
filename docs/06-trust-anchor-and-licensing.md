# 06 — Trust Anchor and Licensing Decisions

Answers to three questions, researched via the Tavily API (batches 8–10 plus targeted extractions;
raw data in [research/raw](../research/raw)).

**Short answers:**

1. **On-device keystore signing: yes, real value — but not from a pure PWA.** Google shipped exactly
   this on Pixel 10 and reached the highest C2PA assurance level currently defined. An S23+ has the
   hardware (Knox Vault / StrongBox) to do the same. The blocker is the browser, not the phone.
2. **Base cannot be the C2PA trust anchor** — C2PA claim signatures require X.509 certificates with
   specific EKUs from a CA on the C2PA Trust List, and that is not substitutable. But Base *is*
   genuinely useful for a different job: an **independent, institution-proof archival timestamp
   anchor**, at ~$0.002 per batch of unlimited captures.
3. **CC BY 4.0, plus a contributor gate.** Share-alike protects against a threat you don't have and
   blocks the downstream use you *do* want (feeding measured data into proprietary CAD/BIM
   deliverables). Control who contributes via access + CLA, not via licence restriction.

---

## 1. Is there value in signing via the device keystore on a Samsung S23+?

### Yes — and there is now a shipping precedent that proves it

Google announced (Sep 2025) that Pixel 10's Camera app signs **C2PA Content Credentials** using
hardware-backed Android security, and:

> "The Pixel Camera application on the Pixel 10 lineup has achieved **Assurance Level 2, the highest
> security rating currently defined by the C2PA Conformance Program.**"
> — <https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/>

And, critically for us:

> "The C2PA Conformance Program requires verifiable artifacts backed by a **hardware Root of Trust,
> which Android provides through features like Key Attestation.** This means **Android developers can
> leverage these same tools** to build apps that meet this standard for their users."

The C2PA Conformance Program currently defines **two assurance levels**: Level 1 with flexible
requirements, and **Level 2 requiring hardware-backed key storage and dynamic security evidence**
(SSL.com, contentauthenticity.org, Trust Over IP). Hardware-backed keystore signing is the *only*
route to Level 2.

The **S23+ qualifies on hardware**: Samsung Knox Vault is a discrete secure element implementing
**StrongBox Keymaster**, and Android Key Attestation produces a certificate chain rooted in Google's
attestation root, asserting the security level (`TrustedEnvironment` or `StrongBox`), verified boot
state, and the identity of the app that requested the key.

### What device signing actually proves — and what it doesn't

| Claim | Proven by device keystore signing? |
|---|---|
| These bytes were produced by *this app* on *this genuine, unmodified device* | **Yes** — via key attestation + verified boot + app identity binding |
| The bytes have not changed since capture | **Yes** |
| The file was not swapped, edited, or synthesised between capture and upload | **Yes — this is the real win.** It closes the gap our current design leaves open |
| The scene in front of the camera was real | **No.** A photo of a printed photo still signs perfectly |
| The measurement is correct | **No.** That is what the calibration tier and hold-out check are for |

Our current architecture signs at **ingest**, which means everything between the shutter and the
server is unattested. Device signing moves the root of trust to the moment of capture. For Landmarks
submissions and any adversarial context (insurance, litigation, contested designation), that gap
matters.

### The blocker: a PWA cannot reach Android Keystore

This is the honest constraint, and it is the reason this isn't already in the plan:

- **Web Crypto** can create non-extractable keys, but they are **software-backed and origin-bound**.
  There is no hardware attestation, no verified-boot binding, no proof of *which* device.
- **WebAuthn** *does* reach hardware-backed keys and supports attestation — but it is designed for
  authentication ceremonies, not for signing arbitrary payloads at capture rate. Enterprise attestation
  is also gated (it typically requires managed devices and an allow-list), so it does not generalise to
  public crowd contributors.
- **There is no web API that exposes Android Keystore for general-purpose signing.** Full stop.

So the options are:

| Option | Assurance | Cost | Trade-off |
|---|---|---|---|
| **A. Pure PWA, server-side signing at ingest** *(current plan)* | C2PA Level 1 achievable | Lowest | Shutter→ingest gap unattested. Zero install, maximum crowd reach |
| **B. TWA / thin native wrapper** — PWA UI inside a native shell that owns capture + Keystore signing | **Level 2 reachable** | Play Store presence, signing key management, ~weeks of work | Loses "no install"; the crowd-sourcing reach argument weakens |
| **C. Hybrid, tiered by contributor** — PWA for the public; native companion for trained/professional contributors | Both | Two clients to maintain | Matches the tiered-evidence model we already have |

### Recommendation

**Adopt (C), phased — but do not build it yet.**

- **v1: stay pure PWA with ingest signing.** Zero install is what makes crowd-sourcing work at all, and
  Level 1 conformance is genuinely useful. Do not trade mass participation for an assurance level no
  reviewer is currently asking for.
- **Design for it now, at zero cost:** the client already computes a SHA-256 at capture. Add a
  `capture_attestation` block to the sidecar schema — nullable today, populated by the native client
  later. Nothing downstream needs to change when it arrives.
- **Phase 4+: build the native capture companion** for `professional` and `trained` contributor tiers,
  where a Knox Vault-backed signature genuinely changes what the evidence is worth. Gate it on a real
  requirement — an LPC reviewer, an insurer, or counsel actually asking for it.

Note also that C2PA explicitly supports **offline signing** with pre-provisioned certificates renewed
later (c2pa.org FAQ), which fits our offline-first field model without modification.

**Value verdict: high, but deferred.** The hardware is capable, the standard rewards it, and the
precedent exists — but the cost is the install-free property that the entire crowd-sourcing thesis
rests on. Do it for the tiers where it pays.

---

## 2. Can Base (or any blockchain) provide the C2PA trust anchor?

**No for the trust anchor. Yes for something else that is genuinely worth having.** The question
conflates three distinct jobs, and they have three different answers.

### Job 1 — Signing the C2PA claim: blockchain cannot do this

C2PA claim signatures are hard-specified:

- The signing certificate must be **X.509**, carrying the **`id-kp-emailProtection` or
  `id-kp-documentSigning`** Extended Key Usage, and must be valid for exactly one of three C2PA
  purposes (signing / time-stamping / OCSP), per the C2PA Implementation Guidance.
- For conformance, the certificate must chain to a CA on the **C2PA Trust List** (SSL.com, TrustAsia
  and others are listed as of 2025).
- **Self-signed certificates validate cryptographically but are reported as untrusted** — verifiers
  surface a warning, which in a Landmarks or legal context is worse than useless.
- Cost is not the obstacle: roughly **$289/year** for a C2PA claim-signing certificate.

An Ethereum/Base key is a secp256k1 keypair with no X.509 identity, no EKU, and no path to the trust
list. A verifier implementing the spec will not accept it. **Substituting Base here doesn't save
money; it produces output that fails validation.**

### Job 2 — Asserting *who* the creator is: partially, with caveats

This is a **separate layer** from claim signing, and it's the one people usually mean. The CAWG
(Creator Assertions Working Group) identity assertion sits *inside* the C2PA manifest and has
deliberately open credential requirements:

> Core requirements: credentials must "be independently verifiable (a public key for a given credential
> can be located by any interested verifying party)" and "have the capacity to sign arbitrary binary
> payloads." — <https://cawg.io/about/identity-framework/>

A Base-anchored identity (e.g. `did:pkh` over an Ethereum address, or an **Ethereum Attestation
Service** attestation) satisfies both requirements in principle. The CAWG 1.3 draft explicitly permits
DID verification methods — with a pointed warning:

> "Other DID verification methods MAY be used but implementers are advised that such DID documents
> **may not be widely understood by identity assertion consumers.**"

In production, CAWG currently defines **two** credential flavours: X.509 certificates (institutional
creators) and **identity claims aggregation** verifiable credentials (Adobe's Connected Identities is
the primary implementation). Blockchain identity is *permitted but not idiomatic*, and no verifier your
users will actually run is likely to render it meaningfully.

Also note the CAWG framework's own warning that its X.509 identity certificates **"are not compatible
with the C2PA claim generator certificates used to sign C2PA manifests"** — the two layers are
genuinely separate, and conflating them is the most common mistake in this space.

**Verdict: technically permissible, practically premature.** It would produce an assertion that
validates for us and is opaque to everyone else.

### Job 3 — Independent timestamp and archival anchoring: **yes, and this is the good idea**

Here blockchain does something a CA genuinely cannot, and it maps onto a real weakness in our design.

The problem: **C2PA's own long-term validity depends on institutions surviving.** Signing certificates
expire. CAs go out of business. Trust lists change. C2PA's answer is RFC 3161 time-stamps —

> "Time-stamps remain valid even after the signing credential of the time-stamp authority expires, so
> long as the attested time falls within the time-stamp authority's certificate's validity period."
> — C2PA Specification 2.4

— which works, but still ultimately rests on a TSA's certificate and an institution's continued
existence. For a **heritage archive with a 50–100 year horizon**, that is a genuine structural risk.
This is the same reason PAdES B-LTA requires periodic re-timestamping.

A public ledger anchor is a credible complement:

- **Cost is negligible.** Base L2 transactions run about **$0.001–0.002**. And you never need one
  transaction per photo — publish a **daily Merkle root** over every manifest hash ingested that day
  (the OpenTimestamps pattern). One transaction covers unlimited captures. **Under $1/year.**
- **No vendor dependency.** Anyone can verify a Merkle inclusion proof against a public chain without
  our servers, our CA, or our organisation existing.
- **Tamper-evidence for the archive itself.** It proves we haven't quietly rewritten history — which
  matters precisely because we're the ones asserting the measurements.

The honest limits, from the research:

- **Legal recognition is weak.** Blockchain notarisation "lacks universal legal recognition; courts
  often require additional evidence for admissibility; certified notarisation through a QTSP is
  generally preferred." So it supplements RFC 3161 — it does not replace it.
- It proves *existence at a time*, nothing about content validity or identity.
- It adds an operational dependency (a funded wallet, key custody, chain liveness) for a benefit that
  only materialises decades out. Chain choice is itself a long-horizon bet.

### Recommendation

```
C2PA claim signing        →  X.509 cert from a C2PA Trust List CA        (~$289/yr, non-negotiable)
Trusted timestamp         →  RFC 3161 TSA                                (spec-native, legally recognised)
Creator identity          →  contributor tier + org identity in CAWG     (defer DIDs until consumers exist)
Archival anchor           →  daily Merkle root published to Base         (optional, <$1/yr, real longevity value)
```

Treat the Base anchor as a **Phase 5 archival-durability feature**, not as trust infrastructure. It is
cheap, genuinely useful for a 100-year archive, and — importantly — **additive**: if it turns out to be
a bad bet, you drop it and every C2PA manifest remains fully valid.

The one thing to avoid is presenting a chain anchor *as* the trust anchor. It would fail C2PA
validation, and heritage/legal reviewers would read it as substituting novelty for standards
compliance.

---

## 3. CC BY vs CC BY-SA — trade-offs

Given your position (*"happy if this is just open source contributions for now, with controls on who
can contribute"*), the key insight is that **those are two independent levers**:

- **Licence** governs what *downstream users* may do with published material.
- **Contributor controls** govern who may *submit* in the first place.

Share-alike is often reached for as a way to "keep it open," but it constrains your consumers, not your
contributors — it is the wrong tool for the goal you stated.

### The mechanics

| | **CC BY 4.0** | **CC BY-SA 4.0** |
|---|---|---|
| Attribution required | Yes | Yes |
| Commercial use | Yes | Yes |
| Adaptations may be licensed | **Any licence, including proprietary** | **Must be CC BY-SA 4.0** (or a CC-listed compatible licence) |
| Compatible with other licences | Broadly | **Not compatible with non-CC licences** (GPLv3 is a listed one-way exception) |
| Additional restrictions on downstream | May not add restrictions | May not add restrictions |

### Why share-alike is the wrong fit *here*

**1. It blocks your actual use case.** The purpose of this corpus is to feed measured facade data into
architectural and engineering deliverables — CAD/BIM models, restoration drawings, LPC submissions.
Those are produced in proprietary formats, inside commercial projects, mixed with client-confidential
material. Under BY-SA, a drawing that adapts a BY-SA orthophoto is an adaptation and must be released
BY-SA. **You would be asking preservation architects to open-source their client deliverables.** They
will simply not use the corpus — the OpenStreetMap/ODbL experience is the cautionary tale here: OSM's
own wiki notes that commercial use of derivative data without compliance "can be problematic" and
recommends legal advice, which is precisely the friction that deters adoption.

**2. Much of your most valuable output may not be copyrightable at all.** Measurements are *facts*.
In the US (post-*Feist*), facts and the data in them are not subject to copyright — so a share-alike
condition on measurement values is of doubtful enforceability, while still successfully scaring off
cautious institutional lawyers. (The EU's *sui generis* database right complicates this, which is an
argument for stating your intent explicitly rather than relying on copyright mechanics.) You would get
the deterrent effect without the protection.

**3. The threat model doesn't apply.** Share-alike defends against enclosure — someone taking the
commons, improving it, and closing the improvements. Your corpus is **provenance-bound and
continuously re-verified**: its value is in the signed lineage, the calibration tiers, and the
corroboration graph, none of which a copier can replicate by taking a JPEG. The moat is the C2PA chain
and the curation, not the licence.

**4. Mixed-licence corpora are an operational tax.** One BY-SA image in an export package can
contaminate the whole deliverable, which means building licence-compatibility checking into the export
service (feature E14/I-series) and explaining licence law to volunteers. Wiki Loves Monuments requires
BY-SA and consequently spends real effort on reuse education.

### Where BY-SA genuinely wins

To be fair to the other side — it is the right choice if:

- you want reciprocity from commercial users as the primary goal;
- you intend to federate with Wikimedia Commons / Mapillary, which are already BY-SA (**relevant**:
  ingesting their material into a CC BY corpus is *not* permitted, so this constrains input as well as
  output);
- you fear a well-funded competitor rebuilding a closed product on your volunteers' labour.

### Recommendation

| Asset class | Licence | Reasoning |
|---|---|---|
| **Photographs (raw + derivatives)** | **CC BY 4.0** | Maximum downstream utility; attribution preserves contributor credit, which is what volunteers actually want |
| **Measurements, calibration records, metadata** | **CC0** (or CC BY) | These are largely facts; CC0 removes ambiguity and maximises institutional adoption. State intent explicitly to cover EU database rights |
| **3D models / orthophotos** | **CC BY 4.0** | Consistent with the photographic corpus |
| **Software** | **Apache-2.0** | Permissive with an explicit patent grant — the right default for a standards-adjacent tool |

Plus the controls you actually asked for, which are **orthogonal to the licence**:

1. **Contributor vetting** — invite/approval to submit, matching the existing tier model
   (`public` / `trained` / `professional`).
2. **A lightweight CLA / contributor terms** — contributor affirms they hold the rights and grants the
   project the outbound licence. This is the mechanism that actually protects the project; note the
   standard critique that CLAs add friction, so keep it to a click-through, not a signed PDF.
3. **Publication gating** — curator queue approval before anything becomes public (already specified
   as F6).
4. **Tier-gated access** — nothing prevents publishing verified `CAL-4`/`CAL-5` measurement sets to
   vetted professionals while the general photographic corpus is open.

**Net:** CC BY 4.0 + CC0 for data + Apache-2.0 for code + a contributor gate. You keep control of the
*inbound* side (who contributes, what gets published), and impose no friction on the *outbound* side
(architects and engineers actually using it) — which is where the project's impact lives.

One consequential caveat to decide early: **choosing CC BY means you cannot ingest CC BY-SA material**
(Wikimedia Commons, Mapillary) into the corpus. If sourcing historic comparison imagery from Commons is
important, plan to keep that material in a **separately-licensed collection** with its own manifest
tagging, rather than mixing it in.
