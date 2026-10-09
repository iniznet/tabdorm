(() => {
  if (window.__tabdormFormGuard) return;
  window.__tabdormFormGuard = true;
  const THROTTLE_MS = 1500;
  let lastSent = 0;
  const send = (type) => {
    try { chrome.runtime.sendMessage({ type }); } catch { /* extension reloading */ }
  };
  const onEdit = () => {
    const now = Date.now();
    if (now - lastSent < THROTTLE_MS) return;
    lastSent = now;
    send('dirtyForm');
  };
  window.addEventListener('input', onEdit, true);
  window.addEventListener('change', onEdit, true);
  window.addEventListener('submit', () => {
    lastSent = 0;
    send('clearDirtyForm');
  }, true);
})();