/**
 * Low-glucose card.
 * Static guidance only: it never reads the engine and works offline.
 */

const dialog = document.getElementById('hypoDialog');

function open() {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function close() {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

document.querySelectorAll('[data-hypo]').forEach((button) => button.addEventListener('click', open));
dialog?.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-hypo-close]')) close();
});
