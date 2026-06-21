var ReferenceGuard;

function log(message) {
  Zotero.debug("Reference Guard: " + message);
}

function install() {
  log("installed");
}

function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/ref-guard.js?v=" + encodeURIComponent(version));
  ReferenceGuard.init({ id, version, rootURI });
  ReferenceGuard.addToAllWindows();
  log("started");
}

function onMainWindowLoad({ window }) {
  ReferenceGuard?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ReferenceGuard?.removeFromWindow(window);
}

function shutdown() {
  ReferenceGuard?.removeFromAllWindows();
  ReferenceGuard = undefined;
  log("stopped");
}

function uninstall() {
  log("uninstalled");
}
