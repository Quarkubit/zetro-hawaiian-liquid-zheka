// content.js — FortPort Tools (v3.8): темы + избранное + иконка + копирование.
// Аудио-карточки (.add-lightbox-grid-item-audio) ИСКЛЮЧЕНЫ из логики избранного.
// В панели Избранного: клик по карточке → копирование картинки, ★ → удалить.
(() => {
  'use strict';

  /* ============================================================ */
  /* ПРОВЕРКА КОНТЕКСТА РАСШИРЕНИЯ                                  */
  /* ============================================================ */

  function extAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  /* ============================================================ */
  /* МОДУЛЬ 0: ПРОКИДЫВАНИЕ URL ИКОНКИ В CSS                       */
  /* ============================================================ */

  try {
    if (extAlive()) {
      const iconUrl = chrome.runtime.getURL('new-post-dark.png');
      document.documentElement.style.setProperty('--fp-new-post-icon', `url("${iconUrl}")`);
    }
  } catch (e) {}

  /* ============================================================ */
  /* МОДУЛЬ 1: ТЕМЫ                                                */
  /* ============================================================ */

  const THEME_CLASSES = window.FPT_THEME_CLASSES || [];
  const THEME_STORAGE_KEY = window.FPT_THEME_STORAGE_KEY || 'fpt_theme';

  function applyThemeToDocument(theme) {
    if (!document.documentElement) return;
    THEME_CLASSES.forEach((c) => document.documentElement.classList.remove(c));
    if (theme && THEME_CLASSES.includes(theme)) {
      document.documentElement.classList.add(theme);
    }
  }

  function loadSavedTheme() {
    if (!extAlive()) return;
    try {
      chrome.storage.local.get([THEME_STORAGE_KEY], (res) => {
        if (chrome.runtime.lastError) return;
        applyThemeToDocument(res[THEME_STORAGE_KEY] || '');
      });
    } catch (e) {}
  }
  loadSavedTheme();

  try {
    if (extAlive()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[THEME_STORAGE_KEY]) return;
        applyThemeToDocument(changes[THEME_STORAGE_KEY].newValue || '');
      });
    }
  } catch (e) {}

  /* ============================================================ */
  /* МОДУЛЬ 2: ИЗБРАННОЕ                                           */
  /* ============================================================ */

  let favCache = new Set();
  let cacheLoaded = false;
  let processing = false;
  let processTimer = null;
  let panelOpen = false;
  let activeTab = 'favorites';

  const FAV_PANEL_ID = 'fp-fav-panel';
  const FAV_BTN_ID   = 'fp-fav-open-btn';
  const BTN_CLASS    = 'fav-pin-btn';
  const GRID_CLASS   = 'fp-ordered-grid';

  const MEDIA_MODAL_SELECTOR = '.add-lightbox.add-lightbox-media';

  // ❗ Класс, который НЕ должен обрабатываться (аудио-карточки)
  const AUDIO_CARD_CLASS = 'add-lightbox-grid-item-audio';
  const AUDIO_CARD_ATTR  = 'data-fp-audio';

  const CARD_SELECTORS = [
    '.add-lightbox-body .add-lightbox-grid-item',
    '.add-lightbox-body [class*="grid-item"]',
    '.add-lightbox-body img'
  ];

  const processedCards = new WeakSet();

  /* ---------- Помечаем аудио-карточки ---------- */

  function markAudioCards() {
    try {
      document.querySelectorAll('.' + AUDIO_CARD_CLASS).forEach((el) => {
        if (!el.hasAttribute(AUDIO_CARD_ATTR)) {
          el.setAttribute(AUDIO_CARD_ATTR, '1');
        }
      });
    } catch (e) {}
  }

  function isAudioCard(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.classList && el.classList.contains(AUDIO_CARD_CLASS)) return true;
    if (el.hasAttribute && el.hasAttribute(AUDIO_CARD_ATTR)) return true;
    return false;
  }

  /* ---------- Storage ---------- */

  function loadFavs() {
    return new Promise((resolve) => {
      if (!extAlive()) { resolve(new Set()); return; }
      try {
        chrome.storage.local.get({ favGifs: [] }, (data) => {
          if (chrome.runtime.lastError) { resolve(new Set()); return; }
          resolve(new Set(Array.isArray(data.favGifs) ? data.favGifs : []));
        });
      } catch (e) { resolve(new Set()); }
    });
  }

  function saveFavs() {
    if (!extAlive()) return;
    try { chrome.storage.local.set({ favGifs: Array.from(favCache) }); } catch (e) {}
  }

  /* ---------- URL карточки ---------- */

  function getCardUrl(card) {
    const img = card.querySelector('img');
    if (img) {
      const url = img.currentSrc || img.src ||
                  img.dataset?.src || img.getAttribute('data-src') || '';
      if (url && !url.startsWith('data:image/svg')) return url;
    }
    const video = card.querySelector('video');
    if (video) {
      const url = video.currentSrc || video.src ||
                  video.querySelector('source')?.src || '';
      if (url) return url;
    }
    const candidates = [card, ...Array.from(card.children).slice(0, 4)];
    for (const n of candidates) {
      const bg = getComputedStyle(n).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        const m = bg.match(/url\(["']?(.*?)["']?\)/);
        if (m && m[1] && !m[1].startsWith('data:image/svg')) return m[1];
      }
    }
    return (
      card.dataset?.src || card.dataset?.gif || card.dataset?.sticker ||
      card.dataset?.emoji || card.dataset?.url ||
      card.getAttribute('data-src') || card.getAttribute('data-gif') ||
      card.getAttribute('data-url') || ''
    );
  }

  /* ---------- Состояние карточки ---------- */

  function applyState(card, url) {
    if (isAudioCard(card)) return;

    const isFav = favCache.has(url);
    const btn = card.querySelector('.' + BTN_CLASS);
    if (btn) {
      btn.classList.toggle('active', isFav);
      btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    }
    card.style.outline       = isFav ? '2px solid #ffca28' : 'none';
    card.style.outlineOffset = isFav ? '-2px' : '0';
    card.style.boxShadow     = isFav ? '0 0 12px rgba(255,202,40,0.5)' : 'none';
  }

  /* ---------- Поднятие избранных вверх ---------- */

  function updateOrderInGrid(grid) {
    if (!grid) return;
    const cs = getComputedStyle(grid);
    const isGrid = cs.display.includes('grid');
    const isFlex = cs.display.includes('flex');

    if (isGrid && grid.style.gridAutoFlow !== 'row dense') {
      grid.style.gridAutoFlow = 'row dense';
    }
    if (isFlex && grid.style.flexWrap !== 'wrap') {
      grid.style.flexWrap = 'wrap';
    }

    const children = Array.from(grid.children);

    if (isGrid || isFlex) {
      children.forEach((card) => {
        if (!(card instanceof Element)) return;
        if (isAudioCard(card)) return;
        const url = getCardUrl(card);
        if (!url) return;
        const newOrder = favCache.has(url) ? '-1' : '0';
        if (card.style.order !== newOrder) card.style.order = newOrder;
      });
      return;
    }

    const favs = [];
    const rest = [];
    children.forEach((card) => {
      if (!(card instanceof Element)) return;
      if (isAudioCard(card)) { rest.push(card); return; }
      const url = getCardUrl(card);
      if (url && favCache.has(url)) favs.push(card);
      else rest.push(card);
    });
    let needsReorder = false;
    for (let i = 0; i < favs.length; i++) {
      if (grid.children[i] !== favs[i]) { needsReorder = true; break; }
    }
    if (!needsReorder && favs.length > 0 && rest.length > 0 &&
        grid.children[favs.length] !== rest[0]) {
      needsReorder = true;
    }
    if (needsReorder) [...favs, ...rest].forEach((c) => grid.appendChild(c));
  }

  /* ---------- Клик по ★ ---------- */

  function onPinClick(ev, card, url) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

    if (isAudioCard(card)) return;

    if (favCache.has(url)) favCache.delete(url);
    else favCache.add(url);

    saveFavs();
    applyState(card, url);
    const grid = card.parentElement;
    if (grid) updateOrderInGrid(grid);
    if (panelOpen && activeTab === 'favorites') renderFavPanel();
  }

  /* ---------- Обработка модалок ---------- */

  async function processModals() {
    if (processing) return;
    processing = true;
    try {
      markAudioCards();

      if (!cacheLoaded) {
        favCache = await loadFavs();
        cacheLoaded = true;
      }

      const modals = document.querySelectorAll(MEDIA_MODAL_SELECTOR);
      if (!modals.length) return;

      modals.forEach((modal) => {
        if (modal.id === FAV_PANEL_ID) return;

        const body = modal.querySelector('.add-lightbox-body');
        if (!body) return;

        let grid = body.querySelector('.add-lightbox-grid')
                || body.querySelector('[class*="grid"]')
                || null;

        let cards = [];
        for (const sel of CARD_SELECTORS) {
          const found = body.querySelectorAll(sel);
          if (found.length > 0) { cards = found; break; }
        }
        if (!cards.length && grid) cards = Array.from(grid.children);

        // ❗ Фильтруем аудио-карточки
        cards = Array.from(cards).filter((card) =>
          card instanceof Element && !isAudioCard(card)
        );

        if (!cards.length) return;
        if (!grid) grid = cards[0].parentElement;
        if (grid && !grid.classList.contains(GRID_CLASS)) {
          grid.classList.add(GRID_CLASS);
        }

        cards.forEach((card) => {
          if (isAudioCard(card)) return;
          if (processedCards.has(card)) return;
          const url = getCardUrl(card);
          if (!url) return;

          const cs = getComputedStyle(card);
          if (cs.position === 'static') card.style.position = 'relative';
          if (cs.display === 'inline') card.style.display = 'block';
          if (card.style.height) card.style.height = '';

          const innerImg = card.querySelector('img');
          if (innerImg) {
            if (!innerImg.loading) innerImg.loading = 'lazy';
            innerImg.decoding = 'async';
          }

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = BTN_CLASS;
          btn.textContent = '★';
          btn.title = 'В избранное';
          btn.setAttribute('aria-pressed', 'false');

          btn.addEventListener('click', (ev) => onPinClick(ev, card, url));
          btn.addEventListener('mousedown', (ev) => ev.stopPropagation());
          btn.addEventListener('mouseup', (ev) => ev.stopPropagation());
          btn.addEventListener('touchstart', (ev) => ev.stopPropagation(), { passive: true });

          card.appendChild(btn);
          processedCards.add(card);
          applyState(card, url);
        });

        if (grid) updateOrderInGrid(grid);
      });
    } catch (e) {
      console.warn('[FP-Tools] processModals:', e);
    } finally {
      processing = false;
    }
  }

  function scheduleProcess() {
    if (processTimer) return;
    processTimer = setTimeout(() => { processTimer = null; processModals(); }, 200);
  }

  /* ---------- Вставка URL в активное поле (используется на правый клик) ---------- */

  function insertToActiveInput(text) {
    const active = document.activeElement;
    if (active && active.isContentEditable) {
      try { document.execCommand('insertText', false, text); active.focus(); return; }
      catch (e) {}
    }
    const input = (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT'))
      ? active
      : document.querySelector('textarea:focus, input:focus, .comment-input');
    if (input) {
      const s = input.selectionStart ?? input.value.length;
      const e = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, s) + text + input.value.slice(e);
      input.selectionStart = input.selectionEnd = s + text.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    } else {
      try { navigator.clipboard.writeText(text); } catch (e) {}
    }
  }

  /* ============================================================ */
  /* МОДУЛЬ 4: КОПИРОВАНИЕ КАРТИНОК + ТОСТ                         */
  /* ============================================================ */

  async function copyImageToClipboard(url) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      const blob = await res.blob();

      // Пробуем записать картинку в clipboard (только PNG в Chrome)
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        let pngBlob = blob;
        if (blob.type && blob.type !== 'image/png') {
          try {
            pngBlob = await convertToPng(blob);
          } catch (e) {
            pngBlob = blob; // оставляем как есть — попробуем как есть
          }
        }

        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': pngBlob })
          ]);
          return { ok: true, type: 'image' };
        } catch (e) {
          console.warn('[FP-Tools] clipboard.write failed, fallback to URL', e);
        }
      }

      // Fallback: копируем URL как текст
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return { ok: true, type: 'url' };
      }

      // Последний fallback: execCommand
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);

      return { ok: true, type: 'url' };
    } catch (e) {
      console.warn('[FP-Tools] copy error:', e);
      return { ok: false, error: e };
    }
  }

  function convertToPng(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((pngBlob) => {
            URL.revokeObjectURL(url);
            if (pngBlob) resolve(pngBlob);
            else reject(new Error('toBlob failed'));
          }, 'image/png');
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  let favToastTimer = null;
  function showFavToast(text, color = '#2ecc71') {
    let el = document.getElementById('fp-fav-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fp-fav-toast';
      el.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(10px);
        padding: 10px 20px;
        background: rgba(0, 0, 0, 0.92);
        color: #fff;
        border-radius: 10px;
        font-family: 'Segoe UI', Tahoma, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity .2s ease, transform .2s ease;
        pointer-events: none;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
        max-width: 80vw;
        text-align: center;
      `;
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.borderColor = color;
    el.style.boxShadow = `0 4px 20px rgba(0, 0, 0, 0.5), 0 0 20px ${color}40`;

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    clearTimeout(favToastTimer);
    favToastTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2000);
  }

  /* ============================================================ */
  /* ПАНЕЛЬ ИЗБРАННОГО                                             */
  /* ============================================================ */

  function buildFavPanel() {
    if (document.getElementById(FAV_PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = FAV_PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', display: 'none',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(6px)', webkitBackdropFilter: 'blur(6px)',
      zIndex: '2147483600', padding: '20px', boxSizing: 'border-box',
      fontFamily: 'Tahoma, "Segoe UI", sans-serif'
    });
    panel.innerHTML = `
      <div id="fp-fav-window" style="display:flex;flex-direction:column;width:100%;max-width:520px;max-height:80vh;background:rgba(24,24,30,0.98);border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.7);overflow:hidden;">
        <div id="fp-fav-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:rgba(30,30,38,0.95);border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;gap:10px;">
            <button type="button" class="fp-back" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.08);color:#e8e8ec;border:none;border-radius:50%;cursor:pointer;font-size:14px;">←</button>
            <span style="font-weight:bold;color:#f0f0f0;font-size:15px;">Избранное</span>
          </div>
          <div id="fp-fav-header-actions" style="display:flex;align-items:center;gap:6px;"></div>
          <button type="button" class="fp-close" style="width:28px;height:28px;border-radius:50%;border:none;background:rgba(200,60,60,0.85);color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        <div style="display:flex;gap:6px;padding:10px 18px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
          <button class="fp-tab" data-tab="gifs">Гифки</button>
          <button class="fp-tab" data-tab="stickers">Стикеры</button>
          <button class="fp-tab" data-tab="emoji">Эмодзи</button>
          <button class="fp-tab fp-tab-active" data-tab="favorites">Избранное</button>
        </div>
        <div id="fp-fav-search-wrap" style="padding:10px 18px;">
          <input type="text" id="fp-fav-search" placeholder="Поиск в избранных" style="width:100%;padding:8px 12px;background:rgba(40,40,48,0.9);color:#f0f0f0;border:1px solid rgba(255,255,255,0.08);border-radius:10px;font-family:inherit;font-size:13px;outline:none;box-sizing:border-box;">
        </div>
        <div id="fp-fav-grid" style="flex:1 1 auto;overflow-y:auto;padding:12px 18px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;box-sizing:border-box;"></div>
      </div>
    `;
    document.body.appendChild(panel);

    panel.querySelectorAll('.fp-tab').forEach((tabBtn) => {
      tabBtn.style.cssText = 'padding:6px 12px;background:transparent;color:#a0a0aa;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;border-radius:0;';
      tabBtn.addEventListener('click', () => setActiveTab(tabBtn.dataset.tab));
    });

    panel.querySelector('.fp-close').addEventListener('click', closeFavPanel);
    panel.querySelector('.fp-back').addEventListener('click', closeFavPanel);
    panel.addEventListener('click', (e) => { if (e.target === panel) closeFavPanel(); });
    panel.querySelector('#fp-fav-search').addEventListener('input', (e) => {
      renderFavPanel(e.target.value.trim().toLowerCase());
    });

    addExportImportButtons();
    setActiveTab('favorites');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) closeFavPanel();
  });

  function setActiveTab(tab) {
    activeTab = tab;
    const panel = document.getElementById(FAV_PANEL_ID);
    if (!panel) return;
    panel.querySelectorAll('.fp-tab').forEach((tabBtn) => {
      const isActive = tabBtn.dataset.tab === tab;
      tabBtn.classList.toggle('fp-tab-active', isActive);
      tabBtn.style.color = isActive ? '#ffca28' : '#a0a0aa';
      tabBtn.style.borderBottomColor = isActive ? '#ffca28' : 'transparent';
    });
    const wrap = panel.querySelector('#fp-fav-search-wrap');
    if (wrap) wrap.style.display = (tab === 'favorites') ? 'block' : 'none';
    renderFavPanel();
  }

  function openFavPanel() {
    if (panelOpen) return;
    buildFavPanel();
    const panel = document.getElementById(FAV_PANEL_ID);
    if (!panel) return;
    panel.style.display = 'flex';
    panelOpen = true;
    setActiveTab('favorites');
  }

  function closeFavPanel() {
    const panel = document.getElementById(FAV_PANEL_ID);
    if (panel) panel.style.display = 'none';
    panelOpen = false;
  }

  function renderFavPanel(filter = '') {
    const grid = document.getElementById('fp-fav-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (activeTab === 'favorites') {
      const items = Array.from(favCache);
      const filtered = filter ? items.filter((u) => u.toLowerCase().includes(filter)) : items;
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'grid-column:1/-1;text-align:center;color:#888;padding:40px 20px;font-size:14px;line-height:1.6;';
        empty.textContent = filter ? 'Ничего не найдено' : 'Пока ничего не закреплено. Открой модалку и нажми ★.';
        grid.appendChild(empty);
        return;
      }
      filtered.forEach((url) => grid.appendChild(makeFavCell(url)));
      return;
    }
    const stub = document.createElement('div');
    stub.style.cssText = 'grid-column:1/-1;text-align:center;color:#888;padding:40px 20px;font-size:14px;';
    stub.textContent = 'Эти разделы открываются нативной панелью FortPort.';
    grid.appendChild(stub);
  }

  /* ---------- Ячейка избранного ---------- */

  function makeFavCell(url) {
    const cell = document.createElement('div');
    cell.style.cssText = 'position:relative;width:100%;height:90px;border-radius:8px;overflow:hidden;cursor:pointer;background:#000;transition:transform .15s ease;';

    const img = document.createElement('img');
    img.src = url;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';

    // Hover-оверлей «Копировать»
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.65);
      color: #ffca28;
      font-family: 'Segoe UI', Tahoma, sans-serif;
      font-size: 11px;
      font-weight: 600;
      opacity: 0;
      transition: opacity .15s ease;
      pointer-events: none;
      z-index: 2;
      text-align: center;
      padding: 4px;
      box-sizing: border-box;
    `;
    overlay.textContent = '📋 Копировать';

    // Левый клик — копировать картинку
    cell.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      cell.style.transform = 'scale(0.96)';
      setTimeout(() => { cell.style.transform = ''; }, 150);

      const res = await copyImageToClipboard(url);
      if (res.ok) {
        showFavToast(res.type === 'image'
          ? '✓ Картинка скопирована'
          : '✓ Ссылка скопирована',
          '#2ecc71');
      } else {
        showFavToast('✗ Не удалось скопировать', '#e74c3c');
      }
    });

    // Правый клик — вставить URL в активное поле
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      insertToActiveInput(url);
      closeFavPanel();
      showFavToast('✓ Ссылка вставлена в поле', '#3498db');
    });

    // Hover
    cell.addEventListener('mouseenter', () => { overlay.style.opacity = '1'; });
    cell.addEventListener('mouseleave', () => { overlay.style.opacity = '0'; });

    // Кнопка ★ — удалить из избранного
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.textContent = '★';
    pin.title = 'Убрать из избранного';
    pin.style.cssText = `
      position: absolute;
      top: 4px; right: 4px;
      width: 22px; height: 22px;
      padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7);
      color: #ffca28;
      border: 1px solid #ffca28;
      border-radius: 50%;
      font-size: 11px; line-height: 1;
      cursor: pointer; z-index: 3;
      box-shadow: 0 0 6px rgba(255,202,40,0.6);
    `;
    pin.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      favCache.delete(url);
      saveFavs();
      renderFavPanel();
      showFavToast('★ Удалено из избранного', '#ffca28');
    });
    pin.addEventListener('mouseenter', () => { pin.style.transform = 'scale(1.15)'; });
    pin.addEventListener('mouseleave', () => { pin.style.transform = 'scale(1)'; });

    cell.appendChild(img);
    cell.appendChild(overlay);
    cell.appendChild(pin);
    return cell;
  }

  /* ---------- Кнопка ★ в тулбаре комментария ---------- */

  function addFavButtonToToolbar() {
    const bars = document.querySelectorAll('.comment-media-buttons-container');
    bars.forEach((bar) => {
      if (bar.querySelector('#' + FAV_BTN_ID)) return;
      const btn = document.createElement('button');
      btn.id = FAV_BTN_ID;
      btn.type = 'button';
      btn.className = 'comment-button fp-fav-open-btn';
      btn.title = 'Открыть избранное';
      btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin:0 0 0 6px;padding:0;background:rgba(255,255,255,0.06);color:inherit;border:none;border-radius:50%;cursor:pointer;line-height:0;box-sizing:border-box;flex:0 0 auto;';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.9;pointer-events:none;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openFavPanel(); });
      bar.appendChild(btn);
    });
  }

  /* ============================================================ */
  /* МОДУЛЬ 3: ЗАМЕНА ИКОНКИ .new-post-fab                         */
  /* ============================================================ */

  const NEW_POST_ICON = 'new-post-dark.png';

  function replaceNewPostIcon() {
    if (!extAlive()) return;
    try {
      const url = chrome.runtime.getURL(NEW_POST_ICON);

      document.querySelectorAll('.new-post-fab img').forEach((img) => {
        if (img.dataset.fpReplaced === '1') return;
        img.dataset.fpReplaced = '1';
        img.src = url;
        img.removeAttribute('srcset');
        img.srcset = '';
      });

      document.querySelectorAll('.new-post-fab picture source').forEach((src) => {
        src.removeAttribute('srcset');
        src.srcset = '';
      });

      document.documentElement.style.setProperty(
        '--fp-new-post-icon',
        `url("${url}")`
      );
    } catch (e) {}
  }

  function scheduleReplaceIcon() {
    if (!extAlive()) return;
    replaceNewPostIcon();
    setTimeout(() => extAlive() && replaceNewPostIcon(), 500);
    setTimeout(() => extAlive() && replaceNewPostIcon(), 1500);
    setTimeout(() => extAlive() && replaceNewPostIcon(), 3000);
  }

  /* ============================================================ */
  /* MUTATION OBSERVER                                             */
  /* ============================================================ */

  const observer = new MutationObserver((mutations) => {
    if (!extAlive()) return;

    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;

        const isMediaModal =
          node.classList?.contains('add-lightbox-media') ||
          node.querySelector?.('.add-lightbox-media');

        const isToolbar =
          node.classList?.contains('comment-media-buttons-container') ||
          node.querySelector?.('.comment-media-buttons-container');

        const isNewPostFab =
          node.classList?.contains('new-post-fab') ||
          node.querySelector?.('.new-post-fab');

        const isAudioCard =
          node.classList?.contains(AUDIO_CARD_CLASS) ||
          node.querySelector?.('.' + AUDIO_CARD_CLASS);

        if (isAudioCard) markAudioCards();
        if (isMediaModal) scheduleProcess();
        if (isToolbar)    addFavButtonToToolbar();
        if (isNewPostFab) setTimeout(replaceNewPostIcon, 100);
      }
    }
  });

  function startObserver() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true });
  }
  startObserver();

  /* ============================================================ */
  /* POLLING FALLBACK                                              */
  /* ============================================================ */

  setInterval(() => {
    if (!extAlive()) return;

    markAudioCards();

    const modals = document.querySelectorAll(MEDIA_MODAL_SELECTOR);
    if (modals.length) {
      let hasUnprocessed = false;
      modals.forEach((modal) => {
        if (modal.id === FAV_PANEL_ID) return;
        const body = modal.querySelector('.add-lightbox-body');
        if (!body) return;
        const cards = body.querySelectorAll(CARD_SELECTORS.join(','));
        cards.forEach((card) => {
          if (isAudioCard(card)) return;
          if (!processedCards.has(card)) hasUnprocessed = true;
        });
      });
      if (hasUnprocessed) scheduleProcess();
    }

    const bars = document.querySelectorAll('.comment-media-buttons-container');
    bars.forEach((bar) => {
      if (!bar.querySelector('#' + FAV_BTN_ID)) addFavButtonToToolbar();
    });

    if (document.querySelector('.new-post-fab')) replaceNewPostIcon();
  }, 500);

  /* ============================================================ */
  /* STORAGE ONCHANGED                                             */
  /* ============================================================ */

  try {
    if (extAlive()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.favGifs) return;
        favCache = new Set(Array.isArray(changes.favGifs.newValue) ? changes.favGifs.newValue : []);
        cacheLoaded = true;
        scheduleProcess();
        if (panelOpen && activeTab === 'favorites') renderFavPanel();
      });
    }
  } catch (e) {}

  /* ============================================================ */
  /* ЭКСПОРТ / ИМПОРТ                                              */
  /* ============================================================ */

  function exportFavorites(format) {
    try {
      const list = Array.from(favCache);
      if (!list.length) { alert('Список пуст'); return; }
      let content, mime, ext;
      if (format === 'json') {
        content = JSON.stringify({ version: 1, favGifs: list }, null, 2);
        mime = 'application/json'; ext = 'json';
      } else {
        content = list.join('\n'); mime = 'text/plain'; ext = 'txt';
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fortport-favorites-${Date.now()}.${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {}
  }

  function importFavorites() {
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
          if (urls.length === 0) urls = trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          urls = urls.filter((u) => /^https?:\/\//i.test(u));
          if (urls.length === 0) { alert('Файл пустой или не содержит ссылок'); return; }
          let added = 0, skipped = 0;
          urls.forEach((u) => {
            if (favCache.has(u)) skipped++;
            else { favCache.add(u); added++; }
          });
          saveFavs();
          if (panelOpen && activeTab === 'favorites') renderFavPanel();
          alert(`Импорт завершён.\nДобавлено: ${added}\nПропущено: ${skipped}`);
        } catch (err) { alert('Не удалось прочитать файл'); }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function makeHeaderIconButton(label, title, bg, fg, border) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.textContent = label;
    btn.style.cssText = `width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:${bg};color:${fg};border:1px solid ${border};border-radius:50%;cursor:pointer;font-size:14px;padding:0;`;
    return btn;
  }

  function addExportImportButtons() {
    const actions = document.getElementById('fp-fav-header-actions');
    if (!actions || actions.dataset.filled === '1') return;
    actions.dataset.filled = '1';

    const importBtn = makeHeaderIconButton('⬆', 'Импорт', 'rgba(60,180,90,0.3)', '#a8e8b8', 'rgba(120,220,150,0.4)');
    importBtn.addEventListener('click', importFavorites);

    const exportTxt = makeHeaderIconButton('⬇', 'Экспорт .txt', 'rgba(60,120,200,0.35)', '#a8c4ff', 'rgba(120,160,240,0.4)');
    exportTxt.addEventListener('click', () => exportFavorites('txt'));

    const exportJson = makeHeaderIconButton('{ }', 'Экспорт .json', 'rgba(150,100,200,0.35)', '#d8b8ff', 'rgba(180,140,240,0.4)');
    exportJson.style.fontSize = '11px';
    exportJson.style.fontWeight = 'bold';
    exportJson.addEventListener('click', () => exportFavorites('json'));

    actions.appendChild(importBtn);
    actions.appendChild(exportTxt);
    actions.appendChild(exportJson);
  }

  /* ============================================================ */
  /* СТАРТ                                                         */
  /* ============================================================ */

  async function init() {
    if (!extAlive()) return;

    markAudioCards();

    favCache = await loadFavs();
    cacheLoaded = true;

    addFavButtonToToolbar();
    scheduleProcess();
    scheduleReplaceIcon();

    setTimeout(() => extAlive() && addFavButtonToToolbar(), 800);
    setTimeout(() => extAlive() && scheduleProcess(), 1500);
    setTimeout(() => extAlive() && scheduleProcess(), 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();