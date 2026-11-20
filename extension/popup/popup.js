document.getElementById('reset-pos-btn')?.addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({
      widgetPosition: { edge: 'right', top: 120 }
    });
    const btn = document.getElementById('reset-pos-btn');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Position Reset!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    }
  } catch (err) {
    console.error('Failed to reset widget position:', err);
  }
});
