/**
 * Service worker registration, install prompt and offline notice.
 */

let registration = null;
let deferredPrompt = null;

const DISMISS_KEY = 'sokerisport.install.dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  );
}

function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* storage may be unavailable; the bar just comes back next visit */
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A worker already controlled the page → this is an update, not the first install.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(installing);
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}

/** Cached assets are replaced only after a reload: say so instead of letting it happen silently. */
function showUpdateBar(worker) {
  if (document.querySelector('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'install-bar update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `
    <div class="install-bar__text">
      <b>A new version is ready</b>
      <span>Reload to get the latest engine and fixes.</span>
    </div>
    <button type="button" class="btn btn--primary btn--sm" data-reload>Reload</button>
    <button type="button" class="link-btn" data-dismiss>Later</button>`;
  document.body.appendChild(bar);

  bar.querySelector('[data-reload]').addEventListener('click', () => {
    worker.postMessage('SKIP_WAITING');
    location.reload();
  });
  bar.querySelector('[data-dismiss]').addEventListener('click', () => bar.remove());
}

/** Small banner: install on Android/desktop, instructions on iOS Safari. */
function showInstallBar() {
  if (dismissed() || isStandalone() || document.querySelector('.install-bar')) return;

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferredPrompt && !ios) return;

  const bar = document.createElement('div');
  bar.className = 'install-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Install SokeriSport');
  bar.innerHTML = `
    <div class="install-bar__text">
      <b>Add SokeriSport to your home screen</b>
      <span>${ios ? 'Tap Share, then “Add to Home Screen”.' : 'Works offline, no app store needed.'}</span>
    </div>
    ${ios ? '' : '<button type="button" class="btn btn--primary btn--sm" data-install>Install</button>'}
    <button type="button" class="link-btn" data-dismiss>Not now</button>`;
  document.body.appendChild(bar);

  bar.querySelector('[data-install]')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    bar.remove();
  });
  bar.querySelector('[data-dismiss]').addEventListener('click', () => {
    rememberDismissed();
    bar.remove();
  });
}

/** Landing pages have no network badge, so they get a compact offline pill. */
function paintOffline() {
  if (document.getElementById('netBadge')) return;
  const offline = !navigator.onLine;
  let pill = document.querySelector('.offline-pill');

  if (!offline) {
    pill?.remove();
    return;
  }
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'offline-pill';
    pill.setAttribute('role', 'status');
    pill.textContent = 'Offline — everything still works.';
    document.body.appendChild(pill);
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  showInstallBar();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  document.querySelector('.install-bar')?.remove();
});

window.addEventListener('online', paintOffline);
window.addEventListener('offline', paintOffline);

window.addEventListener('load', () => {
  paintOffline();
  // iOS never fires beforeinstallprompt; give the hint once the page settles.
  setTimeout(showInstallBar, 2500);
});

registerServiceWorker();
