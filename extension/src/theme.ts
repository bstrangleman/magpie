/** Follow the system light/dark setting (the extension has no per-user theme). */
export function applyTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const set = () => {
    document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
  };
  set();
  media.addEventListener('change', set);
}
