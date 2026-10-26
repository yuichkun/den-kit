// The player's page (player.html): mounts the player (Player.vue). Built on its own
// into dist/player/ (vite.player.config.ts), so den-kit can copy it into a work's
// playable build.
import { createApp } from 'vue';
import { defineWidgets } from '../screen/widgets/widgets.ts';
import Player from './Player.vue';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '../screen/fonts.ts';

defineWidgets();
createApp(Player).mount('#app');
