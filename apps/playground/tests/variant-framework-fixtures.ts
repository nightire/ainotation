/** Real framework fixtures also document the host-side subscription/binding lifecycle. */
export const reactVariants = `
import React, { StrictMode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { defineVariants } from 'virtual:ainotation/variants';
import config from './variants.json';
const group = config ? defineVariants(config) : null;
const original = Object.freeze({ generation: 0, variantId: 'original' });
const subscribe = group?.subscribe ?? (() => () => {});
const getSnapshot = group?.getSnapshot ?? (() => original);
export default function App() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => original);
  const first = useRef(null), second = useRef(null);
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    if (!group || !first.current || !second.current) return;
    const releases = [group.bind(config.targetIds[0], first.current, snapshot), group.bind(config.targetIds[1], second.current, snapshot)];
    return () => releases.forEach(release => release());
  }, [snapshot]);
  return <main><h1>React variants</h1>
    <button id="target-a" ref={first} onClick={() => setCount(value => value + 1)}>{snapshot.variantId === 'original' ? 'Original action' : <><strong>Compact</strong><span> →</span></>}</button>
    {snapshot.variantId === 'original' ? <p id="target-b" ref={second}>Original help</p> : <section id="target-b" ref={second}><strong>Compact help</strong><p>Changed structure</p></section>}
    <output id="count">{count}</output>
  </main>;
}
const root = createRoot(document.querySelector('#root'));
root.render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) { import.meta.hot.accept(); import.meta.hot.dispose(() => { root.unmount(); group?.dispose(); }); }
`;

export const vueVariants = `
<script setup>
import { ref, shallowRef, watchPostEffect, onUnmounted } from 'vue';
import { defineVariants } from 'virtual:ainotation/variants';
import config from './variants.json';
const group = config ? defineVariants(config) : null;
const snapshot = shallowRef(group?.getSnapshot() ?? { generation: 0, variantId: 'original' });
const unsubscribe = group?.subscribe(() => { snapshot.value = group.getSnapshot(); });
const first = ref(null), second = ref(null), count = ref(0);
watchPostEffect((onCleanup) => {
  const rendered = snapshot.value;
  if (!group || !first.value || !second.value) return;
  const releases = [group.bind(config.targetIds[0], first.value, rendered), group.bind(config.targetIds[1], second.value, rendered)];
  onCleanup(() => releases.forEach(release => release()));
});
onUnmounted(() => { unsubscribe?.(); group?.dispose(); });
</script>
<template><main><h1>Vue variants</h1>
  <button id="target-a" ref="first" @click="count++"><template v-if="snapshot.variantId === 'original'">Original action</template><template v-else><strong>Compact</strong><span> →</span></template></button>
  <p v-if="snapshot.variantId === 'original'" id="target-b" ref="second">Original help</p>
  <section v-else id="target-b" ref="second"><strong>Compact help</strong><p>Changed structure</p></section>
  <output id="count">{{ count }}</output>
</main></template>
`;
