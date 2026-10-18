# Repository history

den-kit originated in the `kit/` subtree of den. The source tree was extracted
from commit `d9db3a4ffe3b89279512f4750e2f8cec3b41250c` into this repository's root.

## Preserved history

The extraction retained 47 subtree commits, including their authors, author
dates, messages, and code changes. Moving the subtree to the repository root
changed paths and commit parents, so the commit IDs changed. The
[commit mapping](migration-history.json) records the original and extracted IDs.
The extracted tree matched the source subtree before subsequent changes.

## Independent development

The editor uses published den and unworklet packages instead of aliases into a
neighboring den checkout. Dependencies, tooling, and package versions are
defined in this repository's `package.json` and lockfile. Work document
compatibility was preserved during extraction.

## Licensing

The source retains den's dual licensing: [MIT](../LICENSE-MIT) or
[Apache-2.0](../LICENSE-APACHE), at your option. Attribution for included showcase
assets is recorded in [SOURCES.md](../public/showcase/SOURCES.md).
