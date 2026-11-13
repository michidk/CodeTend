# Security audit skill

The scanner agent bundles the complete `skills/security-audit` directory from
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill),
pinned to commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.
Its MIT license is retained in the vendored directory. Upstream files are
unmodified and excluded from project formatting and linting.

Eve discovers the package in `agent/subagents/scanner/skills/security-audit`,
announces it to scanner sessions, and copies its files into each scanner's
sandbox. Application and CI security tasks explicitly load it in guidance
mode, select the relevant attack-class companions, and use coverage-led
trust-boundary investigation. Their independent exploitability reviewer uses
the candidate-verifier guidance to search for counterevidence. CodeTend's
structured findings and coverage fields carry the results instead of the
standalone skill's report files. Other scanner dimensions keep their existing
investigation instructions.

To update, replace the vendored directory with `skills/security-audit` from a
reviewed upstream commit, copy the repository's `LICENSE` into that directory,
and update the pin above. Keep the full directory so relative companion links
and validators remain available. Run `bunx eve build` from `eve/` and inspect
the compiled scanner skill and sandbox resources. The Docker context must
include Markdown under `eve/agent/`; `.dockerignore` has an exception for it.
