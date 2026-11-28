# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/flavorforge/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| 1.x | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the culinary notebook models, the Process Lab comparator, recipe import validation, export encoding and the `#ff=` share bookmark codec.

In scope:

- Cross-site scripting or DOM injection through rendered recipe, chart, lab or export output.
- Formula injection or control-character smuggling through JSON, CSV or Markdown exports.
- Prototype pollution, hostile keys or malformed input accepted by recipe JSON import, the `#ff=` bookmark codec or the export tamper verification path.
- A checksum or digest flaw that lets a mutated export verify as untampered.

Out of scope:

- Accuracy of the teaching approximations themselves. The models are illustrative and do not predict a particular food, dough culture or espresso machine.
- Denial of service through intentionally extreme input that only affects the local browser tab.
- Reports of missing hardening features rather than an exploitable defect.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial assessment: within 14 calendar days.
- Fix or mitigation plan: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.

We support good-faith security research. If you follow this policy, we will not pursue legal action against you and we will credit your report if you would like.
