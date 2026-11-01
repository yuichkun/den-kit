// workspace: the work's files as a web project in the host's pod
// (docs/architecture.md, "Workspace"). Each work has a pod with a disk of its own,
// used by one window at a time, and its commands run one after another. den-kit
// installs packages (those in package.json, and one the pod check installs without
// keeping it) with npm alone, from the npm registry, with everything else in the pod
// stopped; the dev server starts again after.
// workspace imports work and host only.
export {};
