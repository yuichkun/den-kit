// player: the entry that plays a playable build (src/work/playable.ts). It starts
// only `sound` and `screen`, outside the editor and without a workspace, and never
// changes the work's record: values moved while playing are the player's own state.
// main.ts is its page (player.html, built into dist/player/ by vite.player.config.ts),
// and Player.vue plays the build next to that page. Code parts come only from
// another origin, never the player's own.
export {};
