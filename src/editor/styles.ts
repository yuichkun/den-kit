// The fonts and styles of den-kit's own screens (docs/design-system.md): the fonts the themes
// and the plugin screens use, the themes' tokens, and the shell's styles. The editor's entry
// (start.ts) and its stories (story-frame.ts) load them after App.vue, so the components'
// styles come before the shell's.
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import '../screen/fonts.ts';
// The themes' fonts (tokens.css; all SIL Open Font License 1.1): Tile, Screen and Plate each
// use one sans and one mono.
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/600.css';
import '@fontsource/schibsted-grotesk/700.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/chivo-mono/300.css';
import '@fontsource/chivo-mono/400.css';
import '@fontsource/chivo-mono/500.css';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './tokens.css';
import './style.css';
