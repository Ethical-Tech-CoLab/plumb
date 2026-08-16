# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security problems.** Contact the maintainers of
[Ethical Tech CoLab](https://github.com/ethical-tech-colab) directly.

Please include what you did, what happened, and what you expected. We'll acknowledge receipt and keep
you updated on the fix.

## What we consider security-relevant here

Plumb produces evidence, so its threat model is wider than a typical web app. In particular:

| Class | Examples |
|---|---|
| **Provenance integrity** | Forging or replaying a provenance manifest; breaking the link between a capture and its hash; substituting an image between capture and ingest |
| **Signing material** | Any exposure of C2PA signing keys, TSA credentials, or attestation keys; a path that would let a client obtain a signing key |
| **Measurement integrity** | Any path that lets an unverified or `CAL-0` measurement be presented as verified; bypassing the mandatory hold-out check; silently altering a calibration record |
| **Chain of custody** | Mutating a WORM raw object; rewriting or deleting chain-of-custody events; forking the provenance graph via non-idempotent ingest |
| **Contributor data** | Leaking precise location or identity of a contributor who submitted under restricted visibility |

## Known and accepted limitations

These are documented, not vulnerabilities:

- **C2PA proves pipeline integrity, not scene authenticity.** A signed photograph of a printed
  photograph carries valid credentials. Countered by scale-in-frame, corroboration and sensor-coherence
  checks — never by the signature alone.
- **The shutter→ingest interval is not hardware-attested** in the browser client. A PWA cannot reach
  Android Keystore; Web Crypto keys are software-backed and origin-bound. The client SHA-256 narrows
  the gap; a native attested capture companion is planned. See
  [docs/06-trust-anchor-and-licensing.md](docs/06-trust-anchor-and-licensing.md) §1.
- **Device clocks and GNSS are self-reported.** Only the server-side trusted timestamp is defensible,
  and GNSS is provenance metadata that is never used for scale.
- **Browser storage is evictable.** Field captures can be lost before upload; mitigated by
  `storage.persist()`, quota warnings and local export, not eliminated.

## Cryptographic material

- Signing keys live in an HSM/KMS and are never present in a browser.
- Report any suspected key compromise immediately — the response is key rotation plus re-signing from
  the immutable raw archive.
