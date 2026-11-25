// Quick passages: the Bars ▾ menu's choices laid out under the section bar, one tap each.
// Each quick button stands for one menu item (data-for = its selector inside #bars-pop) and simply
// clicks it, so there is one behaviour, one place it's coded. The quick buttons follow their item:
// disabled / hidden when it is, and the plan's button follows its label (start vs leave).
//
//   mountQuickBars(root) → {destroy()}
export function mountQuickBars(root = document) {
  const bar = root.querySelector('#quick-bars');
  const pop = root.querySelector('#bars-pop');
  if (!bar || !pop) return {destroy() {}};
  const target = btn => pop.querySelector(btn.dataset.for);

  function sync() {
    for (const btn of bar.querySelectorAll('button[data-for]')) {
      const t = target(btn);
      btn.hidden = !t || t.hidden;
      btn.disabled = !!t?.disabled;
      if (t?.id === 'learn-toggle') {
        const leaving = /^\s*(leave|stop)/i.test(t.textContent || '');
        btn.textContent = leaving ? 'Leave plan' : 'Step by step';
        btn.classList.toggle('on', leaving);
      }
      const meta = t?.querySelector('.preset-meta')?.textContent?.trim();
      const base = btn.getAttribute('aria-label') || btn.textContent;
      btn.title = btn.dataset.title ?? (btn.dataset.title = btn.title || '');
      if (meta) btn.title = `${base} · ${meta}`;
    }
    // A separator never starts, ends or doubles up the row.
    let lastVisible = null;
    for (const el of bar.children) {
      if (el.classList.contains('qb-sep')) { el.hidden = !lastVisible || lastVisible.classList.contains('qb-sep'); }
      if (!el.hidden) lastVisible = el;
    }
    if (lastVisible?.classList.contains('qb-sep')) lastVisible.hidden = true;
  }

  const onClick = e => {
    const btn = e.target.closest('button[data-for]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    target(btn)?.click();
    btn.blur?.();
  };
  bar.addEventListener('click', onClick);
  const watch = new MutationObserver(sync);
  watch.observe(pop, {subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'], childList: true, characterData: true});
  sync();
  return {destroy() { watch.disconnect(); bar.removeEventListener('click', onClick); }};
}
