import { mountSamples } from './samples';

export function mountRoutes() {
  const view = document.querySelector<HTMLElement>('#route-view')!;
  const samples = view.innerHTML;
  const events = new AbortController();
  let routeEvents: AbortController | undefined;
  let disposeSamples: (() => void) | undefined;
  let renderedUrl = '';
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-playground-route]')];

  function renderRoute() {
    if (renderedUrl === location.href) return;
    renderedUrl = location.href;
    routeEvents?.abort();
    disposeSamples?.();
    disposeSamples = undefined;
    routeEvents = new AbortController();
    const { signal } = routeEvents;
    const checkout = location.pathname.replace(/\/$/, '') === '/checkout';
    for (const link of links) {
      if (new URL(link.href).pathname === (checkout ? '/checkout' : '/'))
        link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = checkout ? 'Checkout · Ainotation Playground' : 'Ainotation Playground';
    if (!checkout) {
      view.innerHTML = samples;
      const input = view.querySelector<HTMLInputElement>('#sample-text')!;
      const output = view.querySelector<HTMLOutputElement>('#sample-output')!;
      input.addEventListener('input', () => (output.value = input.value), { signal });
      disposeSamples = mountSamples();
      return;
    }
    view.innerHTML = `
      <section class="sample" aria-labelledby="checkout-heading">
        <h2 id="checkout-heading">Checkout</h2>
        <p class="sample-description">Review your order before continuing.</p>
        <article class="order-card" aria-labelledby="order-summary-heading">
          <h3 id="order-summary-heading">Order summary</h3>
          <div class="order-line"><span>Starter kit</span><strong>$49.00</strong></div>
          <p class="sample-description">A collection of components for your next project.</p>
          <div class="order-total"><span>Total</span><strong>$49.00</strong></div>
          <button id="checkout-continue" class="primary" type="button">Continue to payment</button>
          <output id="checkout-result" class="sample-result" aria-live="polite">Ready to continue.</output>
        </article>
      </section>`;
    view.querySelector('#checkout-continue')!.addEventListener(
      'click',
      () => {
        view.querySelector<HTMLOutputElement>('#checkout-result')!.value =
          'Payment step opened for this sample.';
      },
      { signal },
    );
  }

  for (const link of links)
    link.addEventListener(
      'click',
      (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.defaultPrevented
        )
          return;
        event.preventDefault();
        if (location.href === link.href) return;
        history.pushState(null, '', link.href);
        renderRoute();
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      { signal: events.signal },
    );
  window.addEventListener('popstate', renderRoute, { signal: events.signal });
  renderRoute();
  return () => {
    events.abort();
    routeEvents?.abort();
    disposeSamples?.();
  };
}
