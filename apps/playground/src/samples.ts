import { ChevronDown, ChevronRight, createElement, X } from 'lucide';

export function mountSamples() {
  const events = new AbortController();
  const { signal } = events;
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const trigger = element<HTMLButtonElement>('sample-menu-trigger');
  const menu = element<HTMLDivElement>('sample-menu');
  const container = element<HTMLDivElement>('sample-menu-container');
  const submenuTrigger = element<HTMLButtonElement>('sample-submenu-trigger');
  const submenu = element<HTMLDivElement>('sample-submenu');
  const result = element<HTMLOutputElement>('sample-menu-result');
  const icons = [
    ['menu', ChevronDown],
    ['submenu', ChevronRight],
    ['modal-close', X],
  ] as const;
  for (const [name, icon] of icons)
    document.querySelector(`[data-icon="${name}"]`)!.replaceChildren(createElement(icon));

  const items = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(
      (item) => item.closest('[role="menu"]') === root,
    );
  function positionMenus() {
    if (menu.hidden) return;
    const bounds = trigger.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const size = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(bounds.left, width - size.width - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(bounds.bottom + 6, height - size.height - 12))}px`;
    if (!submenu.hidden) {
      const parent = menu.getBoundingClientRect();
      const row = submenuTrigger.getBoundingClientRect();
      const child = submenu.getBoundingClientRect();
      const right = parent.right + 4;
      const left = parent.left - child.width - 4;
      submenu.style.left = `${Math.max(12, Math.min(right + child.width <= width - 12 ? right : left >= 12 ? left : width - child.width - 12, width - child.width - 12))}px`;
      submenu.style.top = `${Math.max(12, Math.min(row.top - 5, height - child.height - 12))}px`;
    }
  }
  function closeSubmenu(focus = false) {
    submenu.hidden = true;
    submenuTrigger.setAttribute('aria-expanded', 'false');
    if (focus) submenuTrigger.focus({ preventScroll: true });
  }
  function openSubmenu(focus = false) {
    submenu.hidden = false;
    submenuTrigger.setAttribute('aria-expanded', 'true');
    positionMenus();
    if (focus) items(submenu)[0]?.focus({ preventScroll: true });
  }
  function closeMenu(focus = false) {
    closeSubmenu();
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus({ preventScroll: true });
  }
  function openMenu(last = false) {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionMenus();
    (last ? items(menu).at(-1) : items(menu)[0])?.focus({ preventScroll: true });
  }
  trigger.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu(true)), { signal });
  trigger.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(event.key === 'ArrowUp');
      }
    },
    { signal },
  );
  submenuTrigger.addEventListener('click', () => openSubmenu(true), { signal });
  submenuTrigger.addEventListener(
    'pointerenter',
    (event) => {
      if (event.pointerType === 'mouse') openSubmenu();
    },
    { signal },
  );
  for (const button of container.querySelectorAll<HTMLButtonElement>('[data-menu-action]')) {
    button.addEventListener(
      'click',
      () => {
        result.value = `Selected: ${button.dataset.menuAction}`;
        closeMenu(true);
      },
      { signal },
    );
    if (button.closest('[role="menu"]') === menu)
      button.addEventListener(
        'pointerenter',
        (event) => {
          if (event.pointerType === 'mouse') closeSubmenu();
        },
        { signal },
      );
  }
  for (const root of [menu, submenu])
    root.addEventListener(
      'keydown',
      (event) => {
        const controls = items(root);
        const index = controls.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? controls.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) %
                  controls.length;
          controls[next]?.focus();
        } else if (event.key === 'ArrowRight' && document.activeElement === submenuTrigger) {
          event.preventDefault();
          event.stopPropagation();
          openSubmenu(true);
        } else if (event.key === 'Escape' || (event.key === 'ArrowLeft' && root === submenu)) {
          event.preventDefault();
          event.stopPropagation();
          if (root === submenu) closeSubmenu(true);
          else closeMenu(true);
        } else if (event.key === 'Tab') closeMenu(true);
      },
      { signal },
    );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !event.composedPath().includes(container)) closeMenu();
    },
    { capture: true, signal },
  );
  window.addEventListener('resize', positionMenus, { signal });
  document.addEventListener('scroll', positionMenus, { capture: true, signal });

  const modalTrigger = element<HTMLButtonElement>('sample-modal-trigger');
  const overlay = element<HTMLDivElement>('sample-modal-overlay');
  const dialog = element<HTMLElement>('sample-modal');
  const form = element<HTMLFormElement>('sample-modal-form');
  const name = element<HTMLInputElement>('sample-project-name');
  const description = element<HTMLTextAreaElement>('sample-project-description');
  const modalResult = element<HTMLOutputElement>('sample-modal-result');
  const background = [
    ...document.querySelectorAll<HTMLElement>('body > main, body > .page-header'),
  ];
  let previousInert: boolean[] = [];
  let previousOverflow = '';
  let savedName = name.value;
  let savedDescription = description.value;
  function closeModal(restoreFocus = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    background.forEach((node, index) => (node.inert = previousInert[index] ?? false));
    document.documentElement.style.overflow = previousOverflow;
    if (restoreFocus) modalTrigger.focus({ preventScroll: true });
  }
  modalTrigger.addEventListener(
    'click',
    () => {
      if (!overlay.hidden) return;
      closeMenu();
      previousInert = background.map((node) => node.inert);
      background.forEach((node) => (node.inert = true));
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      name.value = savedName;
      description.value = savedDescription;
      overlay.hidden = false;
      name.focus({ preventScroll: true });
    },
    { signal },
  );
  for (const id of ['sample-modal-close', 'sample-modal-cancel', 'sample-modal-backdrop'])
    element(id).addEventListener('click', () => closeModal(), { signal });
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeModal();
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex="0"]'),
      ].filter((node) => !node.matches(':disabled'));
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    { signal },
  );
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      savedName = name.value.trim() || 'Untitled project';
      savedDescription = description.value;
      modalResult.value = `Saved project: ${savedName}`;
      closeModal();
    },
    { signal },
  );
  return () => {
    events.abort();
    closeMenu();
    closeModal(false);
  };
}
