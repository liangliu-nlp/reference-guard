(function () {
  const CODE_VERSION = "0.3.1";
  const CSS_ID = "reference-guard-style";
  const INSTALLED_ATTR = "data-reference-guard";
  const HIGHLIGHT_CLASS = "ref-guard-target-highlight";

  function clip(value, length = 160) {
    value = String(value || "").replace(/\s+/g, " ").trim();
    return value.length > length ? value.slice(0, length) + "..." : value;
  }

  function appendDiagnostic(line) {
    try {
      let Cc = Components.classes;
      let Ci = Components.interfaces;
      let file = Services.dirsvc.get("ProfD", Ci.nsIFile);
      file.append("reference-guard.log");
      let stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      stream.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
      let converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      converter.init(stream, "UTF-8");
      converter.writeString(line + "\n");
      converter.close();
    }
    catch (_) {}
  }

  function diag(message, data) {
    let line = `[${new Date().toISOString()}] ${message}`;
    if (data) {
      try {
        line += " " + JSON.stringify(data);
      }
      catch (_) {}
    }
    appendDiagnostic(line);
    try {
      if (typeof Zotero !== "undefined") Zotero.debug("Reference Guard: " + line);
    }
    catch (_) {}
  }

  function unwrap(value) {
    try {
      return value?.wrappedJSObject || Components.utils.waiveXrays(value);
    }
    catch (_) {
      return value;
    }
  }

  function numberArray(value, limit = 16) {
    value = unwrap(value);
    let out = [];
    for (let i = 0; i < limit; i++) {
      try {
        let number = Number(value?.[i]);
        if (!Number.isFinite(number)) break;
        out.push(number);
      }
      catch (_) {
        break;
      }
    }
    return out;
  }

  function objectArray(value, limit = 10000) {
    value = unwrap(value);
    let length = 0;
    try {
      length = Math.min(Number(value?.length) || 0, limit);
    }
    catch (_) {}
    let out = [];
    for (let i = 0; i < length; i++) {
      try {
        out.push(unwrap(value[i]));
      }
      catch (_) {}
    }
    return out;
  }

  function getPDFApplication(win) {
    return win.wrappedJSObject?.PDFViewerApplication
      || win.PDFViewerApplication
      || win.document.defaultView?.wrappedJSObject?.PDFViewerApplication
      || null;
  }

  function currentPageNumber(win) {
    let app = unwrap(getPDFApplication(win));
    return Number(unwrap(app?.pdfViewer)?.currentPageNumber || app?.page) || 0;
  }

  function getZoteroReaderView(win) {
    let parent = null;
    try {
      parent = unwrap(win.parent);
    }
    catch (_) {}
    let reader = unwrap(parent?._reader);
    if (!reader) return null;

    let rawWin = unwrap(win);
    for (let name of ["_primaryView", "_secondaryView", "_lastView"]) {
      let view = unwrap(reader[name]);
      if (!view) continue;
      if (unwrap(view._iframeWindow) === rawWin || name === "_lastView") return view;
    }
    return null;
  }

  function destinationPoint(destArray) {
    let mode = unwrap(destArray?.[1]);
    mode = typeof mode === "string" ? mode : mode?.name || "";
    let finite = (value) => {
      if (value == null) return null;
      value = Number(value);
      return Number.isFinite(value) ? value : null;
    };
    let x = null;
    let y = null;
    if (mode === "XYZ") {
      x = finite(destArray[2]);
      y = finite(destArray[3]);
    }
    else if (mode === "FitH" || mode === "FitBH") {
      y = finite(destArray[2]);
    }
    else if (mode === "FitV" || mode === "FitBV") {
      x = finite(destArray[2]);
    }
    else if (mode === "FitR") {
      let x1 = finite(destArray[2]);
      let y1 = finite(destArray[3]);
      let x2 = finite(destArray[4]);
      let y2 = finite(destArray[5]);
      if (x1 != null && x2 != null) x = Math.min(x1, x2);
      if (y1 != null && y2 != null) y = Math.max(y1, y2);
    }
    return { x, y };
  }

  function isReferenceDestination(dest) {
    if (typeof dest !== "string") return false;
    return /(?:^|[.#/_-])(?:cite|citation|bib|bibr|ref|references?)(?:[.#/_-]|\d|$)/i.test(dest);
  }

  function rectDistanceSquared(point, rect) {
    let dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    let dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return dx * dx + dy * dy;
  }

  function destinationTextDistanceSquared(point, rect) {
    if (point.x == null) {
      let dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
      return dy * dy;
    }
    let dx = rect.left - point.x;
    let dy = rect.top - point.y;
    return dx * dx + dy * dy;
  }

  function annotationLinkAtPoint(links, x, y, padding = 1) {
    let hits = (links || []).filter((link) => (
      x >= link.left - padding && x <= link.right + padding
      && y >= link.top - padding && y <= link.bottom + padding
    ));
    if (!hits.length) return null;
    return hits.reduce((best, link) => (
      (link.right - link.left) * (link.bottom - link.top) < (best.right - best.left) * (best.bottom - best.top) ? link : best
    ), hits[0]);
  }

  async function resolveDestination(state, dest) {
    if (!dest) return null;
    let cached = typeof dest === "string" ? state.destinationCache.get(dest) : null;
    if (cached) return cached;

    let promise = (async () => {
      let explicitDest = dest;
      if (typeof dest === "string") explicitDest = await state.pdfDocument.getDestination(dest);
      explicitDest = objectArray(explicitDest, 16);
      if (!explicitDest.length) return null;

      let destRef = unwrap(explicitDest[0]);
      let pageNumber = null;
      if (destRef && typeof destRef === "object") {
        pageNumber = state.pdfDocument.cachedPageNumber?.(destRef);
        if (!pageNumber && state.pdfDocument.getPageIndex) {
          pageNumber = (await state.pdfDocument.getPageIndex(destRef)) + 1;
        }
      }
      else if (Number.isInteger(destRef)) {
        pageNumber = destRef + 1;
      }
      if (!pageNumber) return null;
      return { pageNumber, destArray: explicitDest, point: destinationPoint(explicitDest) };
    })();

    if (typeof dest === "string") state.destinationCache.set(dest, promise);
    return promise;
  }

  async function navigateDestination(state, dest, resolved) {
    try {
      let view = getZoteroReaderView(state.win);
      if (view?.navigate) {
        if (view._pushHistoryPoint) await view._pushHistoryPoint();
        await view.navigate({ dest });
        return true;
      }
    }
    catch (error) {
      diag("navigate.history.error", { message: String(error) });
    }

    let linkService = unwrap(state.app?.pdfLinkService || state.app?.linkService);
    if (linkService?.goToDestination) {
      await linkService.goToDestination(dest);
      return true;
    }
    if (resolved && state.pdfViewer?.scrollPageIntoView) {
      state.pdfViewer.scrollPageIntoView({ pageNumber: resolved.pageNumber, destArray: resolved.destArray });
      return true;
    }
    return false;
  }

  function pageLooksLikeReferences(pageDiv) {
    let text = Array.from(pageDiv.querySelectorAll(".textLayer span"))
      .map((span) => String(span.textContent || "").trim())
      .filter(Boolean);
    if (text.some((line) => /\b(references|bibliography)\b/i.test(line))) return true;
    let numbered = text.filter((line) => /^\s*\[?\d{1,3}[\].)]\s+/.test(line)).length;
    let authorYear = text.filter((line) => /^[A-Z][A-Za-z'’-]+(?:,|\s).*(?:19|20)\d{2}/.test(line)).length;
    return numbered >= 3 || authorYear >= 3;
  }

  function highlightDestination(state, dest, resolved) {
    if (!resolved?.point || resolved.point.y == null) return false;
    let pageView = unwrap(state.pdfViewer.getPageView?.(resolved.pageNumber - 1));
    let viewport = unwrap(pageView?.viewport);
    let pageDiv = pageView?.div || state.doc.querySelector(`.page[data-page-number="${resolved.pageNumber}"]`);
    if (!viewport?.convertToViewportPoint || !pageDiv) return false;
    if (!isReferenceDestination(dest) && !pageLooksLikeReferences(pageDiv)) return false;

    let pageRect = pageDiv.getBoundingClientRect();
    let hasX = resolved.point.x != null;
    let anchor = numberArray(viewport.convertToViewportPoint(hasX ? resolved.point.x : 0, resolved.point.y), 2);
    if (anchor.length < 2) return false;
    let point = { x: hasX ? anchor[0] : null, y: anchor[1] };
    let items = Array.from(pageDiv.querySelectorAll(".textLayer span")).map((span) => {
      let rect = span.getBoundingClientRect();
      return {
        span,
        text: clip(span.textContent, 100),
        rect: {
          left: rect.left - pageRect.left,
          top: rect.top - pageRect.top,
          right: rect.right - pageRect.left,
          bottom: rect.bottom - pageRect.top
        }
      };
    }).filter((item) => item.text && item.rect.right - item.rect.left > 2 && item.rect.bottom - item.rect.top > 2);
    if (!items.length) return false;

    let target = items.reduce((best, item) => (
      destinationTextDistanceSquared(point, item.rect) < destinationTextDistanceSquared(point, best.rect) ? item : best
    ), items[0]);
    let distance = Math.sqrt(destinationTextDistanceSquared(point, target.rect));
    if (distance > 90) return false;

    for (let old of state.doc.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) old.remove();
    let highlight = state.doc.createElement("div");
    highlight.className = HIGHLIGHT_CLASS;
    highlight.style.position = "fixed";
    highlight.style.left = `${pageRect.left + target.rect.left}px`;
    highlight.style.top = `${pageRect.top + target.rect.top - 2}px`;
    highlight.style.width = `${target.rect.right - target.rect.left}px`;
    highlight.style.height = `${target.rect.bottom - target.rect.top + 4}px`;
    highlight.style.zIndex = "2147483647";
    highlight.style.pointerEvents = "none";
    highlight.style.background = "rgba(255, 212, 0, 0.72)";
    highlight.style.borderRadius = "2px";
    highlight.style.boxShadow = "0 0 0 2px rgba(245, 166, 35, 0.95)";
    (state.doc.body || state.doc.documentElement).appendChild(highlight);
    state.win.setTimeout(() => highlight.remove(), 2000);
    diag("destination.highlight", {
      dest: typeof dest === "string" ? dest : "explicit",
      page: resolved.pageNumber,
      text: target.text,
      distance: Math.round(distance)
    });
    return true;
  }

  function scheduleHighlight(state, clickId, dest, resolved) {
    for (let delay of [60, 160, 350, 700, 1200, 2000]) {
      state.win.setTimeout(() => {
        if (state.destroyed || state.clickId !== clickId || state.highlightedClickId === clickId) return;
        if (highlightDestination(state, dest, resolved)) state.highlightedClickId = clickId;
      }, delay);
    }
  }

  async function onAnnotationClick(state, dest, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    let clickId = ++state.clickId;
    try {
      let resolved = await resolveDestination(state, dest);
      if (!resolved || state.clickId !== clickId) return;
      diag("annotation.click", {
        dest: typeof dest === "string" ? dest : "explicit",
        from: currentPageNumber(state.win),
        to: resolved.pageNumber,
        point: resolved.point
      });
      await navigateDestination(state, dest, resolved);
      scheduleHighlight(state, clickId, dest, resolved);
    }
    catch (error) {
      diag("annotation.click.error", { message: String(error) });
    }
  }

  function pageAtPoint(state, element, x, y) {
    let page = element?.closest?.(".page");
    if (page) return page;
    return Array.from(state.doc.querySelectorAll(".page[data-page-number]")).find((candidate) => {
      let rect = candidate.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }) || null;
  }

  function frameOffset(win) {
    let x = 0;
    let y = 0;
    let current = win;
    try {
      while (current?.parent && current !== current.parent) {
        let frame = current.frameElement;
        if (!frame) break;
        let rect = frame.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        current = current.parent;
      }
    }
    catch (_) {}
    return { x, y };
  }

  function captureAnnotationClick(state, event) {
    let element = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!element) return;
    let pageDiv = pageAtPoint(state, element, event.clientX, event.clientY);
    let pageNumber = Number(pageDiv?.dataset?.pageNumber);
    let pageEntry = state.pageLayers.get(pageNumber);
    if (!pageEntry || pageEntry.pageDiv !== pageDiv) return;

    let pageRect = pageDiv.getBoundingClientRect();
    let offset = frameOffset(state.win);
    let points = [
      { x: event.clientX - pageRect.left, y: event.clientY - pageRect.top, space: "iframe" },
      { x: event.clientX - offset.x - pageRect.left, y: event.clientY - offset.y - pageRect.top, space: "forwarded" }
    ];
    let point = points.find((candidate) => annotationLinkAtPoint(pageEntry.links, candidate.x, candidate.y));
    let hit = point && annotationLinkAtPoint(pageEntry.links, point.x, point.y);
    if (!hit) {
      if (element.closest?.(".linkAnnotation, .annotationLayer a, .annotationLayer button")) {
        diag("annotation.boundsMiss", { page: pageNumber, points, offset, links: pageEntry.links.length });
      }
      return;
    }
    diag("annotation.boundsHit", { page: pageNumber, dest: typeof hit.dest === "string" ? hit.dest : "explicit", space: point.space });
    if (event.type === "click" && Date.now() - state.lastPointerHitAt < 1000) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      return;
    }
    if (event.type === "pointerdown") state.lastPointerHitAt = Date.now();
    onAnnotationClick(state, hit.dest, event);
  }

  function pageSignature(pageDiv, viewport) {
    return [pageDiv.clientWidth, pageDiv.clientHeight, viewport?.scale, viewport?.rotation].join(":");
  }

  async function buildPageLayer(state, pageDiv, pageNumber, signature) {
    try {
      let pageView = unwrap(state.pdfViewer.getPageView?.(pageNumber - 1));
      let viewport = unwrap(pageView?.viewport);
      let pdfPage = unwrap(await state.pdfDocument.getPage(pageNumber));
      let annotations = unwrap(await pdfPage.getAnnotations({ intent: "display" }));
      if (state.destroyed || !pageDiv.isConnected || pageSignature(pageDiv, viewport) !== signature) return;

      let links = 0;
      let linkMap = [];
      for (let annotation of objectArray(annotations)) {
        annotation = unwrap(annotation);
        if (annotation?.url || annotation?.unsafeUrl) continue;
        let dest = unwrap(annotation?.dest);
        if (!dest) continue;
        let rect = numberArray(annotation.rect, 4);
        let firstPoint = numberArray(viewport.convertToViewportPoint?.(rect[0], rect[1]), 2);
        let secondPoint = numberArray(viewport.convertToViewportPoint?.(rect[2], rect[3]), 2);
        if (firstPoint.length < 2 || secondPoint.length < 2) continue;

        let left = Math.min(firstPoint[0], secondPoint[0]);
        let top = Math.min(firstPoint[1], secondPoint[1]);
        let width = Math.abs(secondPoint[0] - firstPoint[0]);
        let height = Math.abs(secondPoint[1] - firstPoint[1]);
        if (width < 1 || height < 1) continue;

        linkMap.push({ dest, left, top, right: left + width, bottom: top + height });
        links++;
      }
      state.pageLayers.set(pageNumber, { pageDiv, signature, links: linkMap });
      if (links) diag("annotation.layer", { page: pageNumber, annotations: annotations?.length || 0, links });
      pdfPage.cleanup?.();
    }
    catch (error) {
      diag("annotation.layer.error", { page: pageNumber, message: String(error) });
    }
    finally {
      state.building.delete(pageNumber);
    }
  }

  function scanPages(state) {
    if (state.destroyed) return;
    for (let pageDiv of state.doc.querySelectorAll(".page[data-page-number]")) {
      let pageNumber = Number(pageDiv.dataset.pageNumber);
      if (!pageNumber || state.building.has(pageNumber)) continue;
      let pageView = unwrap(state.pdfViewer.getPageView?.(pageNumber - 1));
      let viewport = unwrap(pageView?.viewport);
      if (!viewport?.convertToViewportPoint) continue;
      let signature = pageSignature(pageDiv, viewport);
      let existing = state.pageLayers.get(pageNumber);
      if (existing?.pageDiv === pageDiv && existing.signature === signature) continue;
      state.building.add(pageNumber);
      buildPageLayer(state, pageDiv, pageNumber, signature);
    }
  }

  function schedulePageScan(state) {
    if (state.scanQueued || state.destroyed) return;
    state.scanQueued = true;
    state.win.setTimeout(() => {
      state.scanQueued = false;
      scanPages(state);
    }, 0);
  }

  ReferenceGuard = {
    id: null,
    version: null,
    rootURI: null,
    windows: new Map(),
    frames: new Map(),

    init({ id, version, rootURI }) {
      this.id = id;
      this.version = version;
      this.rootURI = rootURI;
    },

    log(message) {
      diag("error", { message: String(message) });
    },

    addToAllWindows() {
      let seen = new Set();
      if (typeof Zotero !== "undefined" && Zotero.getMainWindows) {
        for (let win of Zotero.getMainWindows()) {
          seen.add(win);
          this.addToWindow(win);
        }
      }
      if (typeof Services !== "undefined" && Services.wm) {
        let enumerator = Services.wm.getEnumerator(null);
        while (enumerator.hasMoreElements()) {
          let win = enumerator.getNext();
          if (!seen.has(win)) this.addToWindow(win);
        }
      }
    },

    removeFromAllWindows() {
      for (let win of Array.from(this.windows.keys())) this.removeFromWindow(win);
    },

    addToWindow(win) {
      if (!win?.document || this.windows.has(win)) return;
      let scan = () => this.scanFrameTree(win, win, 0, new Set());
      let observer = new win.MutationObserver(scan);
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
      win.addEventListener("load", scan, true);
      let timer = win.setInterval(scan, 1000);
      this.windows.set(win, { observer, scan, timer, frames: new Set() });
      scan();
    },

    removeFromWindow(win) {
      let entry = this.windows.get(win);
      if (!entry) return;
      entry.observer.disconnect();
      win.removeEventListener("load", entry.scan, true);
      win.clearInterval(entry.timer);
      for (let frameWin of entry.frames) this.removeFromFrame(frameWin);
      this.windows.delete(win);
    },

    scanFrameTree(win, parentWin, depth, seen) {
      if (!win?.document || seen.has(win.document) || depth > 5) return;
      seen.add(win.document);
      this.addToFrame(win, parentWin);
      for (let frame of win.document.querySelectorAll("iframe, browser")) {
        try {
          if (frame.contentWindow?.document) this.scanFrameTree(frame.contentWindow, parentWin, depth + 1, seen);
        }
        catch (_) {}
      }
    },

    addToFrame(win, parentWin) {
      let doc = win.document;
      if (!doc?.documentElement || doc.documentElement.hasAttribute(INSTALLED_ATTR)) return;
      if (!doc.querySelector(".pdfViewer, #viewerContainer")) return;
      let app = unwrap(getPDFApplication(win));
      let pdfViewer = unwrap(app?.pdfViewer);
      let pdfDocument = unwrap(app?.pdfDocument);
      if (!pdfViewer || !pdfDocument) return;

      doc.documentElement.setAttribute(INSTALLED_ATTR, "true");
      let style = doc.createElement("link");
      style.id = CSS_ID;
      style.rel = "stylesheet";
      style.href = this.rootURI + "src/ref-guard.css?v=" + CODE_VERSION;
      (doc.head || doc.documentElement).appendChild(style);

      let state = {
        win,
        doc,
        app,
        pdfViewer,
        pdfDocument,
        clickId: 0,
        highlightedClickId: 0,
        destinationCache: new Map(),
        pageLayers: new Map(),
        building: new Set(),
        scanQueued: false,
        lastPointerHitAt: 0,
        destroyed: false
      };
      let pageObserver = new win.MutationObserver(() => schedulePageScan(state));
      pageObserver.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
      let onPageRendered = () => schedulePageScan(state);
      let clickHandler = (event) => captureAnnotationClick(state, event);
      let eventBus = unwrap(app.eventBus);
      eventBus?.on?.("pagerendered", onPageRendered);
      eventBus?.on?.("scalechanging", onPageRendered);
      eventBus?.on?.("rotationchanging", onPageRendered);
      win.addEventListener("resize", onPageRendered);
      doc.addEventListener("pointerdown", clickHandler, true);
      doc.addEventListener("click", clickHandler, true);

      state.pageObserver = pageObserver;
      state.eventBus = eventBus;
      state.onPageRendered = onPageRendered;
      state.clickHandler = clickHandler;
      this.frames.set(win, state);
      this.windows.get(parentWin)?.frames.add(win);
      scanPages(state);
      diag("attach", {
        version: this.version,
        codeVersion: CODE_VERSION,
        page: currentPageNumber(win),
        strategy: "scholar-annotation-overlay"
      });
    },

    removeFromFrame(win) {
      let state = this.frames.get(win);
      if (!state) return;
      state.destroyed = true;
      state.pageObserver.disconnect();
      state.eventBus?.off?.("pagerendered", state.onPageRendered);
      state.eventBus?.off?.("scalechanging", state.onPageRendered);
      state.eventBus?.off?.("rotationchanging", state.onPageRendered);
      win.removeEventListener("resize", state.onPageRendered);
      state.doc.removeEventListener("pointerdown", state.clickHandler, true);
      state.doc.removeEventListener("click", state.clickHandler, true);
      state.doc.getElementById(CSS_ID)?.remove();
      state.doc.documentElement?.removeAttribute(INSTALLED_ATTR);
      for (let highlight of state.doc.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) highlight.remove();
      this.frames.delete(win);
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ReferenceGuardTestHooks: {
        annotationLinkAtPoint,
        destinationPoint,
        destinationTextDistanceSquared,
        isReferenceDestination,
        rectDistanceSquared
      }
    };
  }
})();
