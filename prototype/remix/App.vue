<script setup lang="ts">
// The prototype's views, chosen by the address's hash: #p=… a passage received
// through a link, #inbox the authors' inbox, nothing the start, where an example
// work is shared as its author.
import { onBeforeUnmount, ref } from 'vue';
import HomeView from './HomeView.vue';
import InboxView from './InboxView.vue';
import ReceiveView from './ReceiveView.vue';
import { passageText } from './passage.ts';

const hash = ref(location.hash);
const follow = () => {
  hash.value = location.hash;
  window.scrollTo(0, 0);
};
window.addEventListener('hashchange', follow);
onBeforeUnmount(() => window.removeEventListener('hashchange', follow));
</script>

<template>
  <div class="page">
    <header class="bar">
      <a class="brand" href="#">den-kit <span class="muted">· Pass it on</span></a>
      <span class="tag">Prototype</span>
      <nav>
        <a href="#">Start</a>
        <a href="#inbox" data-testid="nav-inbox">Authors' inbox</a>
      </nav>
    </header>
    <InboxView v-if="hash === '#inbox'" />
    <ReceiveView v-else-if="passageText(hash)" :key="hash" :text="passageText(hash)" />
    <HomeView v-else />
    <footer class="note">
      A prototype: a link holds the whole passage, the inbox is kept in this browser only, and the
      names are made up.
    </footer>
  </div>
</template>

<style scoped>
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line-subtle);
  background: var(--app-chrome);
}
.brand {
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}
.muted {
  color: var(--text-muted);
  font-weight: 400;
}
.tag {
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--radius-control);
  color: var(--text-muted);
}
nav {
  margin-left: auto;
  display: flex;
  gap: 16px;
}
nav a {
  color: var(--accent-text);
  text-decoration: none;
}
.note {
  margin-top: auto;
  padding: 12px 20px;
  color: var(--text-muted);
  font-size: 12px;
  border-top: 1px solid var(--line-subtle);
}
</style>
