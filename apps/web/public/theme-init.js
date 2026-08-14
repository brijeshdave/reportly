// Author: Brijesh Dave <https://github.com/brijeshdave>
// Applies the stored theme before first paint, so switching never flashes.
// Mirrors src/lib/theme.ts; keep the storage key and logic in sync.
//
// This is a file rather than an inline <script> so the served page can carry a
// `script-src 'self'` CSP with no hash to keep in step and no 'unsafe-inline'.
// It stays parser-blocking (no defer/async), which is what runs it before paint.
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem("reportly.theme") || "{}");
    var palette = stored.palette || "aurora";
    var mode = stored.mode || "system";
    var dark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    root.setAttribute("data-theme", palette);
    root.classList.toggle("dark", dark);
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "aurora");
  }
})();
