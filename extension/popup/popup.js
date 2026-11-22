// © 2026 Kushal Parajuli

// Initialize popup state
document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('widget-toggle');
  const resetBtn = document.getElementById('reset-pos-btn');
  const testSoundBtn = document.getElementById('test-sound-btn');

  // Load toggle state from storage (default: true)
  try {
    const data = await chrome.storage.local.get({ widgetEnabled: true });
    if (toggle) {
      toggle.checked = data.widgetEnabled !== false;
    }
  } catch (err) {
    console.error('Failed to load widget state:', err);
  }

  // Handle toggle change
  toggle?.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ widgetEnabled: toggle.checked });
    } catch (err) {
      console.error('Failed to save widget toggle:', err);
    }
  });

  // Handle position reset
  resetBtn?.addEventListener('click', async () => {
    try {
      await chrome.storage.local.set({
        widgetPosition: { edge: 'right', top: 120 }
      });
      const original = resetBtn.textContent;
      resetBtn.textContent = 'Position Reset!';
      resetBtn.disabled = true;
      setTimeout(() => {
        resetBtn.textContent = original;
        resetBtn.disabled = false;
      }, 1500);
    } catch (err) {
      console.error('Failed to reset widget position:', err);
    }
  });

  // Handle test alarm sound (plays 3 seconds)
  testSoundBtn?.addEventListener('click', async () => {
    try {
      const original = testSoundBtn.textContent;
      testSoundBtn.textContent = 'Playing Sound...';
      testSoundBtn.disabled = true;

      chrome.runtime.sendMessage({ type: 'TEST_SOUND' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('Test sound error:', chrome.runtime.lastError);
        }
      });

      setTimeout(() => {
        testSoundBtn.textContent = original;
        testSoundBtn.disabled = false;
      }, 3200);
    } catch (err) {
      console.error('Failed to trigger test sound:', err);
    }
  });
});
