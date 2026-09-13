import { createApp } from 'vue';
import App from './App.vue';
import '../../framework-samples.css';

const app = createApp(App);
app.mount('#app');
import.meta.hot?.dispose(() => app.unmount());
