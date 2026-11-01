// player: the entry that plays a playable build (src/work/playable.ts;
// docs/architecture.md, "The work"). It starts only `sound` and `screen`, outside
// the editor and without a workspace. main.ts is its page, and Player.vue plays the
// build next to that page. Code parts come only from another origin, never the
// player's own.
export {};
