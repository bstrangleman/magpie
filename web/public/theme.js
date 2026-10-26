// Apply the last-used theme before first paint to avoid a flash. A separate file rather than an
// inline script, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('magpie:theme') || 'system';
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  if (localStorage.getItem('magpie:largeFont') === '1') document.documentElement.classList.add('large-font');
} catch (e) {}
