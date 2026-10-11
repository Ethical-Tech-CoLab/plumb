# Decision-model recommendation: evidence indexing, not metrology

Date: 2026-10-11. Public-source proposal; no model experiment.
Reviewed [README](https://github.com/Ethical-Tech-CoLab/plumb/blob/6ec6d48092b2bc1d45f029ee4b0241fddaf5f9ca/README.md)
and [contribution rules](https://github.com/Ethical-Tech-CoLab/plumb/blob/6ec6d48092b2bc1d45f029ee4b0241fddaf5f9ca/CONTRIBUTING.md).
Assessment depth: documentation and contribution contract.

## Recommended boundary

Plumb separates raw capture from authoritative post-processing, requires
hold-out calibration, preserves uncertainty and publishes provenance-linked
photo-survey evidence. **Do not use a decision model for dimensions,
calibration, uncertainty intervals, contributor vetting or signature checks.**

An optional research-side task is matching an already-authorized capture's
metadata to a registered landmark/part, or ranking source documents for human
review. Use same subject / related subject / different / insufficient evidence.
Exact coordinates, hashes, IDs and units remain deterministic.

This recommendation affects derived indexing only. It does not change the
shared 3D contracts, bridge geometry, raw images or Turnstone.

## Candidate experiment

Compare exact IDs and fuzzy metadata with a licensed local reranker. Jev's
[reranking recipe](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md),
Microsoft-Decision-1 and Sage may be compared on approved public metadata.
Hosted APIs need separate privacy/license approval; permission to publish a
derivative does not authorize arbitrary processing of raw captures.

Group test data by subject/capture session. Include adjacent similar facades,
uncertain locations, stale labels and absent metadata. Measure candidate recall,
wrong-subject association, calibration, retained evidence and curator effort.
Account for retries, fallback and human corrections in accepted-record cost.

## No-go conditions

Never promote an unverified calibration, measure outside a valid plane,
delete uncertainty, burn overlays into originals or infer contributor authority.
Retain restrictions and license separation. No model number may become a
measurement error bar.

Start offline and shadow-only; adoption requires a demonstrated indexing
benefit and no alteration of metrology outputs. Any later measurement change
requires the existing geometry and uncertainty tests, not a model benchmark.
