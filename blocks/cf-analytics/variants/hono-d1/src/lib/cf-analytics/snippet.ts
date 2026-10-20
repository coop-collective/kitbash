// CLIENT_SNIPPET: the browser half. ES2019, no absolute URL, under 1 KB. Put it in a page script (or <script>…</script>).
//   - nothing at all under Do Not Track or Global Privacy Control
//   - $pageview on load; a click on [data-track="<event>"] sends that event (data-label becomes props.label)
//   - window.__track(name, props) for page scripts
// It only POSTs to the same-origin relay (handleRelay); the relay decides what is kept.
export const RELAY_PATH = "{{kit.relayPath}}";

export const CLIENT_SNIPPET = `(function (w, d, n) {
  if (n.doNotTrack === "1" || w.doNotTrack === "1" || n.globalPrivacyControl) return;
  function t(name, props) {
    try {
      fetch("${RELAY_PATH}", { method: "POST", keepalive: true, body: JSON.stringify({ name: name, props: props || {} }) }).catch(function () {});
    } catch (e) {}
  }
  w.__track = t;
  t("$pageview", { path: location.pathname, ref: d.referrer });
  d.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("[data-track]");
    if (el) t(el.getAttribute("data-track"), { label: el.getAttribute("data-label") || "", href: el.getAttribute("href") || "" });
  }, true);
})(window, document, navigator);`;
