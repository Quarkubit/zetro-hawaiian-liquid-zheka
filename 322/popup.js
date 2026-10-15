// popup.js — FortPort Tools: избранное + темы.
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid');
  const counter = document.getElementById('counter');
  const clearBtn = document.getElementById('clearBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const importBtn = document.getElementById('importBtn');
  const themeSelect = document.getElementById('themeSelect');
  const resetTheme = document.getElementById('resetTheme');

  /* ---------- Избранное ---------- */

  function render() {
    if (!grid) return;
    grid.innerHTML = '';

    chrome.storage.local.get({ favGifs: [] }, (data) => {
      if (chrome.runtime.lastError || !data) data = { favGifs: [] };
      const list = Array.isArray(data.favGifs) ? data.favGifs : [];
      if (counter) counter.textContent = list.length;

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML =
          'Пока пусто.<br>' +
          'Открой панель GIF или фото на FortPort<br>' +
          'и нажми ★ на нужной карточке.';
        grid.appendChild(empty);
        return;
      }

      list.forEach((url) => {
        const img = document.createElement('img');
        img.src = url;
        img.loading = 'lazy';
        img.title = 'Клик — открыть на новой вкладке';
        img.addEventListener('click', () => {
          if (chrome?.tabs?.create) chrome.tabs.create({ url });
          else window.open(url, '_blank');
        });
        grid.appendChild(img);
      });
    });
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTxt() {
    chrome.storage.local.get({ favGifs: [] }, (data) => {
      if (chrome.runtime.lastError || !data) data = { favGifs: [] };
      const list = Array.isArray(data.favGifs) ? data.favGifs : [];
      if (list.length === 0) { alert('Список пуст'); return; }
      download('fortport-favorites-' + Date.now() + '.txt', list.join('\n'), 'text/plain');
    });
  }

  function exportJson() {
    chrome.storage.local.get({ favGifs: [] }, (data) => {
      if (chrome.runtime.lastError || !data) data = { favGifs: [] };
      const list = Array.isArray(data.favGifs) ? data.favGifs : [];
      if (list.length === 0) { alert('Список пуст'); return; }
      const payload = JSON.stringify({ version: 1, favGifs: list }, null, 2);
      download('fortport-favorites-' + Date.now() + '.json', payload, 'application/json');
    });
  }

  function importFavs() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json,application/json,text/plain';

    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target.result;
          const trimmed = text.trim();
          let urls = [];

          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const data = JSON.parse(trimmed);
              if (Array.isArray(data)) urls = data;
              else if (data && Array.isArray(data.favGifs)) urls = data.favGifs;
            } catch (_) {}
          }

          if (urls.length === 0) {
            urls = trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          }

          urls = urls.filter((u) => /^https?:\/\//i.test(u));

          if (urls.length === 0) {
            alert('Файл пустой или не содержит ссылок');
            return;
          }

          chrome.storage.local.get({ favGifs: [] }, (data) => {
            if (chrome.runtime.lastError || !data) data = { favGifs: [] };
            const current = Array.isArray(data.favGifs) ? data.favGifs : [];
            const set = new Set(current);
            let added = 0;

            urls.forEach((u) => {
              if (!set.has(u)) { set.add(u); added++; }
            });

            chrome.storage.local.set({ favGifs: Array.from(set) }, () => {
              render();
              alert(
                `Импорт завершён.\n` +
                `Прочитано: ${urls.length}\n` +
                `Добавлено: ${added}\n` +
                `Пропущено (уже было): ${urls.length - added}`
              );
            });
          });
        } catch (err) {
          console.warn('[FP-Tools] import error:', err);
          alert('Не удалось прочитать файл');
        }
      };
      reader.readAsText(file);
    });

    input.click();
  }

  /* ---------- Темы ---------- */

  const THEME_KEY = window.FPT_THEME_STORAGE_KEY || 'fpt_theme';
  const THEMES = window.FPT_THEMES || [];

  function fillThemeSelect() {
    if (!themeSelect) return;
    themeSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'По умолчанию';
    themeSelect.appendChild(defaultOpt);

    THEMES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      themeSelect.appendChild(opt);
    });
  }

  function loadSavedTheme() {
    if (!themeSelect) return;
    chrome.storage.local.get([THEME_KEY], (res) => {
      if (chrome.runtime.lastError || !res) return;
      themeSelect.value = res[THEME_KEY] || '';
    });
  }

  function bindThemeHandlers() {
    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        const theme = themeSelect.value || '';
        chrome.storage.local.set({ [THEME_KEY]: theme });
      });
    }

    if (resetTheme) {
      resetTheme.addEventListener('click', () => {
        if (themeSelect) themeSelect.value = '';
        chrome.storage.local.set({ [THEME_KEY]: '' });
      });
    }
  }

  /* ---------- Обработчики ---------- */

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!confirm('Удалить всё из избранного?')) return;
      chrome.storage.local.set({ favGifs: [] }, render);
    });
  }

  if (exportTxtBtn)  exportTxtBtn.addEventListener('click', exportTxt);
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJson);
  if (importBtn)     importBtn.addEventListener('click', importFavs);

  /* ---------- Старт ---------- */

  fillThemeSelect();
  loadSavedTheme();
  bindThemeHandlers();

  render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.favGifs) render();
    if (changes[THEME_KEY] && themeSelect) {
      themeSelect.value = changes[THEME_KEY].newValue || '';
    }
  });
});