(() => {
  const dialog = document.getElementById('mu-help');
  const canvas = document.getElementById('canvas');
  const stop = () => {
    const auto = document.getElementById('mu-auto-toggle');
    if (auto.getAttribute('aria-pressed') === 'true') auto.click();
  };
  document.getElementById('mu-help-open').addEventListener('click', () => {
    stop(); dialog.showModal();
  });
  document.getElementById('mu-help-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => canvas.focus());
  // Keep game key handlers from receiving keys while the help dialog is open.
  window.addEventListener('keydown', event => {
    if (dialog.open) event.stopImmediatePropagation();
  }, true);
  const full = document.getElementById('mu-fullscreen');
  if (!document.fullscreenEnabled) {
    full.disabled = true;
    full.title = 'เบราว์เซอร์นี้ไม่รองรับเต็มจอ';
  }
  async function toggleFullscreen() {
    stop();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.getElementById('game-stage').requestFullscreen();
      canvas.focus();
    } catch {
      document.getElementById('auto-status').textContent = 'เปิดเต็มจอไม่ได้ กรุณาลองอีกครั้ง';
    }
  }
  full.addEventListener('click', toggleFullscreen);
  document.getElementById('mu-fullscreen-exit').addEventListener('click', toggleFullscreen);
})();
