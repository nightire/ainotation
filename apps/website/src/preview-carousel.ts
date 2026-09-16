export function createPreviewCarousel(
  element: HTMLElement,
  advance: () => void,
  signal: AbortSignal,
) {
  const duration = 5000;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let hovered = matchMedia('(hover: hover)').matches && element.matches(':hover');
  let pageHidden = false;
  let elapsed = 0;
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const currentElapsed = () =>
    Math.min(duration, elapsed + (timer === undefined ? 0 : performance.now() - started));
  function paint() {
    element.style.setProperty('--preview-progress', String(currentElapsed() / duration));
  }
  function animate() {
    paint();
    frame = requestAnimationFrame(animate);
  }
  function stop() {
    clearTimeout(timer);
    timer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function sync() {
    elapsed = currentElapsed();
    stop();
    if (signal.aborted) return;
    paint();
    const focused = document.activeElement;
    if (
      hovered ||
      pageHidden ||
      document.hidden ||
      reducedMotion.matches ||
      (focused && element.contains(focused) && focused.matches(':focus-visible'))
    )
      return;
    started = performance.now();
    timer = setTimeout(() => {
      stop();
      elapsed = 0;
      advance();
      sync();
    }, duration - elapsed);
    frame = requestAnimationFrame(animate);
  }
  function reset() {
    stop();
    elapsed = 0;
    sync();
  }

  element.addEventListener(
    'pointerenter',
    (event) => {
      if (event.pointerType === 'touch') return;
      hovered = true;
      sync();
    },
    { signal },
  );
  element.addEventListener(
    'pointerleave',
    (event) => {
      if (event.pointerType === 'touch') return;
      hovered = false;
      sync();
    },
    { signal },
  );
  for (const type of ['focusin', 'focusout'])
    element.addEventListener(type, () => queueMicrotask(sync), { signal });
  document.addEventListener('visibilitychange', sync, { signal });
  reducedMotion.addEventListener('change', sync, { signal });
  for (const type of ['pagehide', 'pageshow'])
    window.addEventListener(
      type,
      () => {
        pageHidden = type === 'pagehide';
        sync();
      },
      { signal },
    );
  signal.addEventListener('abort', stop, { once: true });
  sync();
  return { reset };
}
