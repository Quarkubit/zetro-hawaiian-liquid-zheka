// themes.js — общий список тем.
const FPT_THEMES = [
  { id: 'fpt-blue-purple',   label: 'Сине-фиолетовая' },
  { id: 'fpt-black-purple',  label: 'Чёрно-фиолетовая' },
  { id: 'fpt-diagonal',      label: 'Диагональная' },
  { id: 'fpt-multicolor',    label: 'Мультиколор' },
  { id: 'fpt-liquid-glass',  label: 'Тёмное жидкое стекло' },
  { id: 'fpt-winxp',         label: 'Windows XP' },
  { id: 'fpt-backrooms',     label: 'Backrooms (Закулисье)' },
  { id: 'fpt-pokemon',       label: 'Pokémon (тёмная)' },
  { id: 'fpt-nord',          label: 'Nord' },
  { id: 'fpt-dracula',       label: 'Dracula' },
  { id: 'fpt-cyberpunk',     label: 'Cyberpunk 2077' },
  { id: 'fpt-ice',           label: 'Ice (Лёд)' },
  { id: 'fpt-frutiger-aero', label: 'Frutiger Aero' },
  { id: 'fpt-japan',         label: 'Japan (Япония)' },
  { id: 'fpt-gothic',        label: 'Gothic (Готика)' }
];
const FPT_THEME_CLASSES = FPT_THEMES.map(t => t.id);
const FPT_THEME_STORAGE_KEY = 'fpt_theme';
if (typeof window !== 'undefined') {
  window.FPT_THEMES = FPT_THEMES;
  window.FPT_THEME_CLASSES = FPT_THEME_CLASSES;
  window.FPT_THEME_STORAGE_KEY = FPT_THEME_STORAGE_KEY;
}