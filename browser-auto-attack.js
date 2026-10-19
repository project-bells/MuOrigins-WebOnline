// Uses the native exports already present in upstream browser/shell_login.cpp.
// Intentionally does not load the solo app.js or send packets independently.
(() => {
  const module = globalThis.Module;
  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0';
  const existing = document.getElementById?.('mu-auto-toggle');
  const button = existing || document.createElement('button');
  const startLabel = existing ? '▶ Auto' : 'เริ่ม Auto Attack';
  const stopLabel = existing ? '■ Stop' : 'หยุด Auto Attack';
  button.type = 'button';
  button.disabled = true;
  button.textContent = startLabel;
  button.setAttribute('aria-pressed', 'false');
  const status = document.getElementById?.('auto-status') || document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = 'กำลังโหลดระบบโจมตี';
  if (!existing) panel.append(button, status);
  const canvas = module?.canvas || document.querySelector('canvas');
  if (!existing) {
    if (canvas) canvas.before(panel);
    else document.body.append(panel);
  }
  if (!module) {
    status.textContent = 'Auto Attack โหลดผิดลำดับ: ไม่พบ Module';
    return;
  }
  let ready = false;
  let active = false;
  function stop(reason = 'หยุดแล้ว') {
    if (ready && active) module._mu_auto_attack(0);
    active = false;
    button.textContent = startLabel;
    button.setAttribute('aria-pressed', 'false');
    if (ready) status.textContent = reason;
  }
  button.addEventListener('click', () => {
    if (!ready) return;
    if (active) return stop();
    module._mu_auto_attack(1);
    active = true;
    button.textContent = stopLabel;
    button.setAttribute('aria-pressed', 'true');
    status.textContent = 'กำลังโจมตีกลางจอด้วยสกิลคลิกขวา • Esc เพื่อหยุด';
    module.canvas.focus();
  });
  const previous = module.onRuntimeInitialized;
  module.onRuntimeInitialized = function (...args) {
    if (previous) previous.apply(this, args);
    ready = typeof module._mu_auto_attack === 'function' && typeof module._mu_get_auto_attack === 'function';
    button.disabled = !ready;
    status.textContent = ready ? 'เข้าเกมและเลือกสกิลคลิกขวาก่อนเริ่ม • เปลี่ยนแท็บจะหยุด' : 'build นี้ไม่มี Auto Attack exports';
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') stop();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('หยุดเมื่อเปลี่ยนแท็บ');
  });
  window.addEventListener('blur', () => stop('หยุดเมื่อออกจากหน้าต่าง'));
  window.addEventListener('pagehide', () => stop());
})();
