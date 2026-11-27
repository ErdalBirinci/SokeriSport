/** Service worker registration and install flow. */

let registration = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}

registerServiceWorker();
