// workspace: the work's files as a web project in the host's pod. It keeps a
// working copy of the files there, installs packages, builds code parts, runs
// their dev server and runs commands for the person and the AI. Files a command
// changed return to the work as operations made by whoever ran it; the record
// stays in the work. Whether there is a pod at all is the host's decision.
// workspace imports work and host only.
export {};
