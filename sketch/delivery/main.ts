// The delivery sketch's page (delivery.html): what a person handed a sound tool can do
// with it (Delivery.vue). It runs on den-kit's dev server, next to the builds it
// hands over (public/delivery/).
import { createApp } from 'vue';
import { defineWidgets } from '../../src/screen/widgets/widgets.ts';
import Delivery from './Delivery.vue';
import '../../src/editor/styles.ts';

defineWidgets();
createApp(Delivery).mount('#app');
