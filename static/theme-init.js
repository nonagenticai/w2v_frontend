// Blocking theme resolution to prevent FOUC.
// Reads saved theme from localStorage and resolves "default" via system preference.
// Loaded as an external script from app.html so CSP `script-src 'self'` covers it
// without needing an inline-script hash.
//
// Sets BOTH the legacy `data-theme` attribute (drives the old warm-orange
// tokens in app.css) AND the fr `.dark` class (drives the ported fr design
// tokens in tokens.css). The root layout keeps them in sync after hydration;
// this script applies both pre-hydration so neither new chrome nor un-rebuilt
// pages flash the wrong theme.
(function () {
	function apply(name) {
		document.documentElement.setAttribute('data-theme', name);
		document.documentElement.classList.toggle('dark', name === 'dark');
	}
	try {
		var s = JSON.parse(localStorage.getItem('w2v_settings') || '{}');
		var name = (s.theme && s.theme.name) || 'default';
		if (name === 'default') {
			name = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		apply(name);
	} catch (e) {
		apply('dark');
	}
})();
