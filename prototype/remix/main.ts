// The page of the passing-on prototype, served by the development server at
// /prototype/remix/: an example work shared by its author, received through a
// link, changed and passed on, with the author's inbox. It plays works with
// den-kit's own sound and screen, in den-kit's theme.
import { createApp } from 'vue';
import { defineWidgets } from '../../src/screen/widgets/widgets.ts';
import { savedTheme, useTheme } from '../../src/editor/theme.ts';
import App from './App.vue';
import '../../src/editor/styles.ts';

useTheme(savedTheme());
defineWidgets();
createApp(App).mount('#app');
