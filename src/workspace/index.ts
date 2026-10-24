// workspace: the work's files as a web project in the host's pod. Each work has
// a pod with a disk of its own, used by one window at a time. It keeps a working
// copy of the files there, installs packages, builds code parts, runs their dev
// server and runs commands for the person and the AI, one after another. Files a
// command changed return to the work as operations made by whoever ran it; the
// record stays in the work. The pod reaches the internet only while den-kit
// installs packages (those in package.json, and one the pod check installs
// without keeping it): npm alone, from the npm registry, without install scripts,
// with everything else in the pod stopped (the dev server starts again after).
// Whether there is a pod at all is the host's decision.
// workspace imports work and host only.
export {};
