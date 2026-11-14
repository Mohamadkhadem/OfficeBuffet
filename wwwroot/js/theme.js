// Apply the saved light/dark choice before first paint so the page doesn't flash.
// A separate file (not an inline script) so the Content-Security-Policy can forbid inline scripts.
try { const t = localStorage.getItem('officebuffet.theme') ?? localStorage.getItem('officebite.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
