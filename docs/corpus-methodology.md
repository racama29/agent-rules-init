# Corpus methodology

The PR corpus contains 60 offline cases: for every stack, one known framework
signature, one neutral ecosystem project signature and two false-positive guards.
Each minimized signature names the public project that motivated it. This makes the
test deterministic and reviewable without downloading third-party code in CI.

These signatures validate detection logic, but they are not a substitute for running
against full repositories. For that reason the README uses **validated**, not
**stable**, for every stack until the release corpus records pinned commits and reviewed
golden output for at least two positive and two negative full repositories per stack.

## Gates

- Language detection: 100% of positive and neutral cases.
- Framework detection: 100% of framework cases.
- False positives: zero in negative cases.
- Unknown frameworks remain low confidence and are not rendered as observations.
- PR tests are offline; release validation may fetch only pinned commits.

When a source project changes, update its minimized signature in a dedicated commit and
record the reviewed upstream commit here before promoting that stack to stable.
