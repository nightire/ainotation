import './style.css';
import { mountRoutes } from './routes';

// This entry deliberately contains no SDK import or mount call: Vite injects it.
const status = document.querySelector<HTMLElement>('#mount-status')!;
const updateStatus = () => {
  status.textContent = document.querySelector('ainotation-inspector-shell')
    ? 'Mounted automatically'
    : import.meta.env.DEV
      ? 'Loading Ainotation'
      : 'Preview';
};
const observer = new MutationObserver(updateStatus);
observer.observe(document.body, { childList: true });
const disposeRoutes = mountRoutes();
updateStatus();
const dispose = () => {
  observer.disconnect();
  disposeRoutes();
};
const onPageHide = (event: PageTransitionEvent) => {
  if (!event.persisted) dispose();
};
window.addEventListener('pagehide', onPageHide);
import.meta.hot?.dispose(() => {
  window.removeEventListener('pagehide', onPageHide);
  dispose();
});
