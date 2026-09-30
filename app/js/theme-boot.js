/* Apply a saved theme before first paint (loaded synchronously, before the CSS). Fails quietly if storage is blocked. */
try {
  var t = localStorage.getItem('tipnet-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* storage blocked: keep the default theme */
}
