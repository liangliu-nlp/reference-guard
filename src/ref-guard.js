(function () {
  const CODE_VERSION = "0.2.40";
  const CSS_ID = "reference-guard-style";
  const INSTALLED_ATTR = "data-reference-guard";
  const OVERLAY_CLASS = "ref-guard-overlay";
  const EVENT_TYPES = ["click"];
  const LINK_SELECTOR = ".linkAnnotation, .annotationLayer a[href], a[href]";
  const NOISY_DIAGNOSTICS = /^(?:scanFrameTree|scanFrame\.skip|addToFrame\.skip|addToWindow\.skip)$/;

  function clip(value, length = 180) {
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
    if (NOISY_DIAGNOSTICS.test(message)) return;

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

  const Heuristics = {
    cleanText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    },

    isCitationLike(text, context) {
      text = this.cleanText(text);
      context = this.cleanText(context);

      if (/^\[\s*\d{1,3}(?:\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3})*\s*\]$/.test(text)) {
        return true;
      }
      if (/^\d{1,3}$/.test(text)) {
        let bracketedNumbers = context.match(/\[\s*\d{1,3}(?:\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3})*\s*\]/g) || [];
        if (bracketedNumbers.some((group) => (group.match(/\d{1,3}/g) || []).includes(text))) {
          return true;
        }
      }
      if (/\([A-Z][A-Za-z'\u2019.-]+(?:\s+et\s+al\.)?,?\s+(?:19|20)\d{2}[a-z]?\)/.test(context)) {
        return true;
      }
      if (/\b[A-Z][A-Za-z'\u2019.-]+\s+\((?:19|20)\d{2}[a-z]?\)/.test(context)) {
        return true;
      }
      return false;
    },

    isShortNumeric(text) {
      text = this.cleanText(text);
      return /^(?:[\[(]?\s*\d{1,3}\s*[\])]?)$/.test(text)
        || /^\d{1,3}\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3}$/.test(text)
        || /^\d+\s*[\/\u00d7x*+-]\s*\d+$/.test(text);
    },

    isMathContext(context) {
      context = this.cleanText(context);
      if (!context) return false;

      let symbolHits = (context.match(/[=\u2211\u222b\u221a\u2264\u2265\u00b1\u00d7\u00f7\u2248\u2260\u221e\u2202\u2207\u2208\u2209\u2229\u222a\u2282\u2283\u2286\u2287\u2192\u2190\u2194\u03b8\u03bb\u03bc\u03c3\u03c0\u03a9\u03b1\u03b2\u03b3\u03b4\u03f5\u03b7\u03c1\u03c4\u03c6\u03c8]/g) || []).length;
      let operatorHits = (context.match(/\b(?:log|exp|sin|cos|tan|max|min|argmax|argmin|softmax|loss|where)\b|[A-Za-z]\s*[=<>]\s*|[_^{}]|(?:\d|[A-Za-z])\s*[\/+\-*]\s*(?:\d|[A-Za-z])/gi) || []).length;

      return symbolHits + operatorHits >= 2;
    },

    shouldBlock(text, context) {
      text = this.cleanText(text);
      context = this.cleanText(context);
      if (!this.isShortNumeric(text)) return false;
      if (this.isCitationLike(text, context)) return false;
      return this.isMathContext(context);
    },

    isReferenceTrigger(text, context) {
      text = this.cleanText(text);
      context = this.cleanText(context);
      if (this.shouldBlock(text, context)) return false;
      if (this.isCitationLike(text, context)) return true;
      if (/^\[?\s*\d{1,3}(?:\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3})*\s*\]?$/.test(text)
        && /\b(?:see|cf|cited|citation|reference|references|prior|previous|study|studies|paper|papers|work|works|follows|following)\b/i.test(context)) {
        return true;
      }
      if (/^\(?[A-Z][A-Za-z'\u2019.-]+(?:\s+et\s+al\.)?,?\s+(?:19|20)\d{2}[a-z]?\)?$/.test(text)) {
        return true;
      }
      return false;
    },

    parseReferenceTriggers(text, context) {
      let refs = [];
      let seen = new Set();
      let sources = [this.cleanText(text), this.cleanText(context)].filter(Boolean);

      for (let source of sources) {
        let patterns = [
          /\b([A-Z][A-Za-z'\u2019.-]+)\s+et\s+al\.,?\s+\(?((?:19|20)\d{2})([a-z]?)\)?/g,
          /\b([A-Z][A-Za-z'\u2019.-]+)\s+\(((?:19|20)\d{2})([a-z]?)\)/g,
          /\b([A-Z][A-Za-z'\u2019.-]+),\s*((?:19|20)\d{2})([a-z]?)/g
        ];
        for (let pattern of patterns) {
          let match;
          while ((match = pattern.exec(source))) {
            let author = match[1];
            let year = match[2];
            let suffix = match[3] || "";
            let key = `ay:${author.toLowerCase()}-${year}${suffix}`;
            if (!seen.has(key)) {
              let ref = { type: "author-year", author, year, label: match[0] };
              if (suffix) ref.suffix = suffix;
              refs.push(ref);
              seen.add(key);
            }
          }
        }
        if (refs.length) return refs;

        let partialPattern = /\b([A-Z][A-Za-z'\u2019.-]+)\s+et\s+al\.,?/g;
        let partial;
        while ((partial = partialPattern.exec(source))) {
          let author = partial[1];
          let key = `ay:${author.toLowerCase()}-`;
          if (!seen.has(key)) {
            refs.push({ type: "author-year", author, year: "", label: partial[0] });
            seen.add(key);
          }
        }
        if (refs.length) return refs;
      }

      let cleanText = this.cleanText(text);
      let cleanContext = this.cleanText(context);
      let numericSource = `${cleanText} ${cleanContext}`;
      for (let match of numericSource.matchAll(/[\[(]\s*(\d{1,3})(?:\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3})*\s*[\])]/g)) {
        let numbers = match[0].match(/\d{1,3}/g) || [];
        for (let value of numbers.slice(0, 3)) {
          let key = `n:${value}`;
          if (!seen.has(key)) {
            refs.push({ type: "number", number: value, label: match[0] });
            seen.add(key);
          }
        }
        if (refs.length) return refs;
      }

      if (/^\d{1,3}$/.test(cleanText) && !this.isMathContext(cleanContext)) {
        refs.push({ type: "number", number: cleanText, label: cleanText });
      }
      else if (!this.isReferenceTrigger(cleanText, cleanContext)) {
        return refs;
      }
      else if (/^\d{1,3}$/.test(this.cleanText(cleanText.split(/\s+/)[0] || "")) && !this.isMathContext(cleanContext)) {
        let number = this.cleanText(cleanText.split(/\s+/)[0]);
        refs.push({ type: "number", number, label: number });
      }
      return refs;
    },

    citationCandidates(text) {
      text = this.cleanText(text);
      if (!text) return [];

      let candidates = [];
      let add = (start, end, label) => {
        label = this.cleanText(label);
        if (!label) return;
        let refs = this.parseReferenceTriggers(label, "");
        if (!refs.length) return;
        candidates.push({ start, end, text: label, refs });
      };

      let authorYearPatterns = [
        /\b[A-Z][A-Za-z'\u2019.-]+\s+et\s+al\.,?\s+\(?((?:19|20)\d{2})([a-z]?)\)?/g,
        /\b[A-Z][A-Za-z'\u2019.-]+\s+\(((?:19|20)\d{2})([a-z]?)\)/g,
        /\b[A-Z][A-Za-z'\u2019.-]+,\s*((?:19|20)\d{2})([a-z]?)/g
      ];
      for (let pattern of authorYearPatterns) {
        let match;
        while ((match = pattern.exec(text))) {
          add(match.index, match.index + match[0].length, match[0]);
        }
      }

      let numericPattern = /[\[(]\s*(\d{1,3})(?:\s*(?:,|;|-|--|\u2013|\u2014)\s*\d{1,3})*\s*[\])]/g;
      let numeric;
      while ((numeric = numericPattern.exec(text))) {
        add(numeric.index, numeric.index + numeric[0].length, numeric[0]);
      }

      candidates.sort((a, b) => a.start - b.start || b.end - a.end);
      let filtered = [];
      for (let candidate of candidates) {
        if (filtered.some((item) => candidate.start >= item.start && candidate.end <= item.end)) continue;
        filtered.push(candidate);
      }
      return filtered;
    }
  };

  function elementFromTarget(target) {
    if (!target) return null;
    return target.nodeType === 1 ? target : target.parentElement;
  }

  function closest(element, selector) {
    try {
      return element?.closest?.(selector) || null;
    }
    catch (_) {
      return null;
    }
  }

  function textLines(win, { pageNumber = null, visibleOnly = false } = {}) {
    let doc = win.document;
    let root = doc;
    if (pageNumber) {
      root = doc.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!root) return [];
    }

    let spans = Array.from(root.querySelectorAll(".textLayer span, .textLayer div"));
    let visible = [];
    for (let span of spans) {
      let text = Heuristics.cleanText(span.textContent);
      if (!text) continue;
      let rect = span.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (visibleOnly && (rect.bottom < 55 || rect.top > win.innerHeight - 15 || rect.right < 0 || rect.left > win.innerWidth)) {
        continue;
      }
      visible.push({ span, rect, text, page: closest(span, ".page") || span.parentElement });
    }

    visible.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    let lines = [];
    for (let item of visible) {
      let line = lines[lines.length - 1];
      if (!line || line.page !== item.page || Math.abs(line.top - item.rect.top) > 5 || item.rect.left > line.rect.right + 8) {
        line = { page: item.page, top: item.rect.top, spans: [], text: "", rect: item.rect };
        lines.push(line);
      }
      line.spans.push(item.span);
      line.text += (line.text ? " " : "") + item.text;
      line.rect = {
        top: Math.min(line.rect.top, item.rect.top),
        bottom: Math.max(line.rect.bottom, item.rect.bottom),
        left: Math.min(line.rect.left, item.rect.left),
        right: Math.max(line.rect.right, item.rect.right)
      };
    }

    return lines.filter((line) => Heuristics.cleanText(line.text).length > 3);
  }

  function visibleTextLines(win) {
    return textLines(win, { visibleOnly: true });
  }

  function pageTextLines(win, pageNumber) {
    return textLines(win, { pageNumber });
  }

  function unionRects(rects) {
    let out = null;
    for (let rect of rects || []) {
      if (!rect || rect.width < 1 || rect.height < 1) continue;
      out = out ? {
        left: Math.min(out.left, rect.left),
        top: Math.min(out.top, rect.top),
        right: Math.max(out.right, rect.right),
        bottom: Math.max(out.bottom, rect.bottom),
        width: Math.max(out.right, rect.right) - Math.min(out.left, rect.left),
        height: Math.max(out.bottom, rect.bottom) - Math.min(out.top, rect.top)
      } : {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width || rect.right - rect.left,
        height: rect.height || rect.bottom - rect.top
      };
    }
    return out;
  }

  function pointInRect(x, y, rect, xPad = 4, yPad = 7) {
    return !!rect
      && x >= rect.left - xPad
      && x <= rect.right + xPad
      && y >= rect.top - yPad
      && y <= rect.bottom + yPad;
  }

  function lineWithSegments(line) {
    let text = "";
    let segments = [];
    for (let span of line.spans || []) {
      let part = Heuristics.cleanText(span.textContent || "");
      if (!part) continue;
      if (text) text += " ";
      let start = text.length;
      text += part;
      segments.push({
        span,
        text: part,
        start,
        end: start + part.length,
        rect: span.getBoundingClientRect()
      });
    }
    return { text, segments };
  }

  function firstTextNode(element) {
    if (!element) return null;
    for (let node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) return node;
    }
    try {
      let walker = element.ownerDocument.createTreeWalker(element, 4);
      return walker.nextNode();
    }
    catch (_) {
      return null;
    }
  }

  function rawRangeForCleanRange(raw, start, end) {
    raw = String(raw || "");
    let clean = "";
    let map = [];
    let pendingSpace = false;
    let pendingSpaceIndex = -1;
    for (let i = 0; i < raw.length; i++) {
      let ch = raw[i];
      if (/\s/.test(ch)) {
        if (clean) {
          pendingSpace = true;
          if (pendingSpaceIndex < 0) pendingSpaceIndex = i;
        }
        continue;
      }
      if (pendingSpace && clean) {
        map[clean.length] = pendingSpaceIndex;
        clean += " ";
      }
      pendingSpace = false;
      pendingSpaceIndex = -1;
      map[clean.length] = i;
      clean += ch;
    }

    if (Heuristics.cleanText(raw) !== clean || start < 0 || end > clean.length || end <= start) return null;
    let rawStart = map[start];
    let rawEnd = map[end - 1] + 1;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return null;
    return { rawStart, rawEnd };
  }

  function substringRectsForSegment(segment, start, end) {
    let node = firstTextNode(segment.span);
    if (!node) return [];
    let rawRange = rawRangeForCleanRange(node.nodeValue || "", start, end);
    if (!rawRange) return [];
    try {
      let range = segment.span.ownerDocument.createRange();
      range.setStart(node, rawRange.rawStart);
      range.setEnd(node, rawRange.rawEnd);
      return Array.from(range.getClientRects()).filter((rect) => rect.width >= 1 && rect.height >= 1);
    }
    catch (_) {
      return [];
    }
  }

  function candidateRects(segments, candidate) {
    let rects = [];
    for (let segment of segments) {
      if (segment.end <= candidate.start || segment.start >= candidate.end) continue;
      let start = Math.max(0, candidate.start - segment.start);
      let end = Math.min(segment.text.length, candidate.end - segment.start);
      let exact = substringRectsForSegment(segment, start, end);
      rects.push(...(exact.length ? exact : [segment.rect]));
    }
    return rects;
  }

  function citationHitAtPoint(win, x, y) {
    let lines = visibleTextLines(win);
    let nearby = lines.filter((line) => (
      y >= line.rect.top - 9
      && y <= line.rect.bottom + 9
      && x >= line.rect.left - 28
      && x <= line.rect.right + 28
    ));
    if (!nearby.length) return null;

    let candidateCount = 0;
    let context = nearby.map((line) => line.text).join(" ");
    for (let line of nearby) {
      let built = lineWithSegments(line);
      for (let candidate of Heuristics.citationCandidates(built.text)) {
        let rects = candidateRects(built.segments, candidate);
        let rect = unionRects(rects);
        if (!rect) continue;
        candidateCount++;
        if (pointInRect(x, y, rect)) {
          return {
            text: candidate.text,
            context: built.text,
            refs: candidate.refs,
            rects,
            rejected: false,
            candidates: candidateCount
          };
        }
      }
    }

    return candidateCount ? { text: "", context, refs: [], rejected: true, candidates: candidateCount } : null;
  }

  function getScrollRoot(doc) {
    return doc.getElementById("viewerContainer")
      || doc.querySelector(".viewerContainer, .pdfViewer")
      || doc.scrollingElement
      || doc.documentElement;
  }

  function getPDFApplication(win) {
    return win.wrappedJSObject?.PDFViewerApplication
      || win.PDFViewerApplication
      || win.document.defaultView?.wrappedJSObject?.PDFViewerApplication
      || null;
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

  function currentPageNumber(win) {
    let app = unwrap(getPDFApplication(win));
    let pdfViewer = unwrap(app?.pdfViewer);
    return pdfViewer?.currentPageNumber || app?.page || null;
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

  async function prepareZoteroHistory(win) {
    let view = getZoteroReaderView(win);
    if (!view?._pushHistoryPoint) return null;

    await view._pushHistoryPoint();
    let history = unwrap(view._history);
    if (history && "_lastSaveTime" in history) {
      // Zotero coalesces quick history saves; a reference jump should be a hard back point.
      history._lastSaveTime = 0;
    }
    return view;
  }

  function anchorHash(href) {
    href = String(href || "");
    let hashIndex = href.indexOf("#");
    if (hashIndex < 0) return "";
    let hash = href.slice(hashIndex + 1);
    try {
      return decodeURIComponent(hash);
    }
    catch (_) {
      try {
        return unescape(hash);
      }
      catch (_) {
        return hash;
      }
    }
  }

  function destinationFromHref(href) {
    let hash = anchorHash(href);
    if (!hash || hash.startsWith("page=")) return null;
    if (hash.startsWith("nameddest=")) {
      return new URLSearchParams(hash).get("nameddest");
    }
    if (hash[0] === "[") {
      try {
        return JSON.parse(hash);
      }
      catch (_) {
        return null;
      }
    }
    return hash;
  }

  function nativeLinkFromElement(link, direct) {
    if (!link) return null;
    let anchor = link.matches?.("a[href]") ? link : link.querySelector?.("a[href]");
    if (!anchor) return null;

    let href = anchor.getAttribute("href") || anchor.href || "";
    if (/^(?:https?|mailto):/i.test(href)) return null;
    return {
      element: link,
      anchor,
      href,
      dest: destinationFromHref(href),
      direct
    };
  }

  function nativeLinkAtPoint(win, x, y, element) {
    let candidates = Array.from(win.document.elementsFromPoint?.(x, y) || []);
    if (element) candidates.push(element);

    for (let candidate of candidates) {
      let found = nativeLinkFromElement(closest(candidate, LINK_SELECTOR), true);
      if (found) return found;
    }

    let page = closest(element, ".page") || win.document.querySelector(`.page[data-page-number="${currentPageNumber(win)}"]`);
    let anchors = Array.from((page || win.document).querySelectorAll(".annotationLayer a[href], .linkAnnotation a[href], a[href]"));
    for (let anchor of anchors) {
      let rect = anchor.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (x < rect.left - 8 || x > rect.right + 8 || y < rect.top - 8 || y > rect.bottom + 8) continue;
      let found = nativeLinkFromElement(anchor, false);
      if (found) return found;
    }
    return null;
  }

  async function nativeAnnotationAtPoint(win, x, y, element) {
    let app = unwrap(getPDFApplication(win));
    let pdfDocument = unwrap(app?.pdfDocument);
    let pdfViewer = unwrap(app?.pdfViewer);
    if (!pdfDocument?.getPage || !pdfViewer?.getPageView) return null;

    let pageDiv = closest(element, ".page");
    if (!pageDiv) {
      pageDiv = Array.from(win.document.querySelectorAll(".page")).find((page) => {
        let rect = page.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) || win.document.querySelector(`.page[data-page-number="${currentPageNumber(win)}"]`);
    }
    let pageRect = pageDiv.getBoundingClientRect();
    let pageNumber = Number(pageDiv?.dataset?.pageNumber) || currentPageNumber(win);
    if (!pageNumber) return null;

    let pageView = unwrap(pdfViewer.getPageView(pageNumber - 1));
    let viewport = unwrap(pageView?.viewport);
    pageDiv = pageView?.div || pageDiv;
    if (!viewport?.convertToViewportRectangle || !pageDiv) return null;

    let pdfPage = unwrap(await pdfDocument.getPage(pageNumber));
    let getAnnotations = pdfPage?.getAnnotations || pdfPage?.wrappedJSObject?.getAnnotations;
    if (!getAnnotations) return null;

    let annotations = unwrap(await getAnnotations.call(pdfPage, { intent: "display" }));
    let length = 0;
    try {
      length = Number(annotations?.length) || 0;
    }
    catch (_) {}

    for (let index = 0; index < length; index++) {
      let annotation = null;
      try {
        annotation = unwrap(annotations[index]);
      }
      catch (_) {
        continue;
      }

      let dest = null;
      try {
        if (annotation?.url || annotation?.unsafeUrl) continue;
        dest = unwrap(annotation?.dest);
      }
      catch (_) {
        continue;
      }
      if (!dest) continue;

      let rect = numberArray(annotation.rect, 4);
      if (rect.length < 4) continue;

      let firstPoint = numberArray(viewport.convertToViewportPoint(rect[0], rect[1]), 2);
      let secondPoint = numberArray(viewport.convertToViewportPoint(rect[2], rect[3]), 2);
      if (firstPoint.length < 2 || secondPoint.length < 2) continue;

      let left = pageRect.left + Math.min(firstPoint[0], secondPoint[0]);
      let right = pageRect.left + Math.max(firstPoint[0], secondPoint[0]);
      let top = pageRect.top + Math.min(firstPoint[1], secondPoint[1]);
      let bottom = pageRect.top + Math.max(firstPoint[1], secondPoint[1]);
      if (x < left - 24 || x > right + 24 || y < top - 18 || y > bottom + 18) continue;

      return {
        element: null,
        anchor: null,
        href: annotation.id || "pdf-annotation",
        dest,
        direct: false,
        source: "pdfjs-annotation"
      };
    }
    return null;
  }

  function pageForRect(win, rect) {
    let x = Math.max(0, Math.min(win.innerWidth - 1, rect.left + 2));
    let y = Math.max(0, Math.min(win.innerHeight - 1, rect.top + 2));
    for (let element of win.document.elementsFromPoint?.(x, y) || []) {
      let page = closest(element, ".page");
      if (page) return page;
    }

    for (let page of win.document.querySelectorAll(".page")) {
      let pageRect = page.getBoundingClientRect();
      if (rect.right >= pageRect.left && rect.left <= pageRect.right && rect.bottom >= pageRect.top && rect.top <= pageRect.bottom) {
        return page;
      }
    }
    return null;
  }

  function flashRects(win, rects, duration) {
    for (let overlay of win.document.querySelectorAll("." + OVERLAY_CLASS)) {
      overlay.remove();
    }

    let appended = 0;
    let pageAnchored = 0;
    for (let rect of rects) {
      if (!rect || rect.right - rect.left < 2 || rect.bottom - rect.top < 2) continue;

      let overlay = win.document.createElement("div");
      overlay.className = OVERLAY_CLASS;
      let page = pageForRect(win, rect);
      let pageRect = page?.getBoundingClientRect?.();
      overlay.style.position = page ? "absolute" : "fixed";
      overlay.style.left = `${Math.max(0, page ? rect.left - pageRect.left : rect.left)}px`;
      overlay.style.top = `${Math.max(0, page ? rect.top - pageRect.top - 2 : rect.top - 2)}px`;
      overlay.style.width = `${Math.max(2, rect.right - rect.left)}px`;
      overlay.style.height = `${Math.max(2, rect.bottom - rect.top + 4)}px`;
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483647";
      overlay.style.background = "rgba(255, 212, 0, 0.72)";
      overlay.style.borderRadius = "2px";
      overlay.style.boxShadow = "0 0 0 2px rgba(245, 166, 35, 0.95)";
      (page || win.document.body || win.document.documentElement).appendChild(overlay);
      appended++;
      if (page) pageAnchored++;
      win.setTimeout(() => overlay.remove(), duration);
    }
    diag("flashRects", { page: currentPageNumber(win), requested: rects.length, appended, pageAnchored });
  }

  function sameColumn(base, line) {
    let overlap = Math.min(base.rect.right, line.rect.right) - Math.max(base.rect.left, line.rect.left);
    return overlap > 12 || Math.abs(base.rect.left - line.rect.left) < 36;
  }

  async function resolveDestination(win, dest) {
    let app = unwrap(getPDFApplication(win));
    let pdfDocument = unwrap(app?.pdfDocument);
    if (!pdfDocument || !dest) return null;

    let explicitDest = dest;
    if (typeof dest === "string") {
      explicitDest = await pdfDocument.getDestination(dest);
    }
    explicitDest = Array.from(unwrap(explicitDest) || []);
    if (!explicitDest.length) return null;

    let destRef = unwrap(explicitDest[0]);
    let pageNumber = null;
    if (destRef && typeof destRef === "object") {
      pageNumber = pdfDocument.cachedPageNumber?.(destRef);
      if (!pageNumber && pdfDocument.getPageIndex) {
        pageNumber = (await pdfDocument.getPageIndex(destRef)) + 1;
      }
    }
    else if (Number.isInteger(destRef)) {
      pageNumber = destRef + 1;
    }

    if (!pageNumber) return null;
    return { pageNumber, destArray: explicitDest };
  }

  function schedulePageChangeHighlight(win, frameState, clickId, beforePage, refs = []) {
    if (!beforePage) return;
    let flashed = false;
    let delays = [120, 300, 700, 1200, 2000, 3000];
    for (let delay of delays) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId || flashed) return;
        let page = currentPageNumber(win);
        if (page && page > beforePage && refs.length && flashVisibleReference(win, refs)) {
          flashed = true;
          diag("pageChangeHighlight", { from: beforePage, to: page, refs: refs.length });
        }
      }, delay);
    }
  }

  async function openNativeDestination(win, dest, { history = false } = {}) {
    if (history) {
      try {
        let view = await prepareZoteroHistory(win);
        if (view?.navigate) {
          await view.navigate({ dest });
          diag("history.nativeDestination", { page: currentPageNumber(win), dest: typeof dest === "string" ? dest : !!dest });
          return true;
        }
      }
      catch (e) {
        diag("history.nativeDestinationError", { message: String(e) });
      }
    }

    let app = unwrap(getPDFApplication(win));
    let linkService = unwrap(app?.pdfLinkService || app?.linkService);
    if (linkService?.goToDestination && dest) {
      await linkService.goToDestination(dest);
      return true;
    }

    let resolved = await resolveDestination(win, dest);
    let pdfViewer = unwrap(app?.pdfViewer);
    if (resolved && pdfViewer?.scrollPageIntoView) {
      pdfViewer.scrollPageIntoView({ pageNumber: resolved.pageNumber, destArray: resolved.destArray });
      return true;
    }
    return false;
  }

  function wait(win, ms) {
    return new Promise((resolve) => win.setTimeout(resolve, ms));
  }

  function afterPaint(win, fn) {
    if (win.requestAnimationFrame) {
      win.requestAnimationFrame(fn);
    }
    else {
      win.setTimeout(fn, 0);
    }
  }

  function visibleReferenceGroup(win, ref) {
    let lines = visibleTextLines(win);
    let matchesLine = referenceLineMatcher(ref);
    for (let i = 0; i < lines.length; i++) {
      if (!matchesLine(lines[i])) continue;
      let base = lines[i];
      let group = [base];
      let text = base.text;
      for (let j = i + 1; j < lines.length && group.length < 6; j++) {
        if (!sameColumn(base, lines[j])) continue;
        group.push(lines[j]);
        text += " " + lines[j].text;
        if (ref.year && text.includes(ref.year)) break;
      }
      if (!ref.year || text.includes(ref.year)) return group;
    }
    return null;
  }

  function scheduleVisibleReferenceHighlight(win, frameState, refs, clickId, expectedPage) {
    let flashed = false;
    for (let delay of [40, 180, 420]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
        if (flashed) return;
        if (expectedPage && currentPageNumber(win) !== expectedPage) return;
        for (let ref of refs) {
          let group = visibleReferenceGroup(win, ref);
          if (!group) continue;
          let baseRect = group[0].rect;
          let rects = group.map((line) => ({
            left: Math.max(line.rect.left, baseRect.left - 8),
            top: line.rect.top,
            right: Math.min(line.rect.right, baseRect.right + 24),
            bottom: line.rect.bottom
          })).filter((rect) => rect.right - rect.left > 2);
          flashRects(win, rects, 4200);
          diag("fallback.visiblePageChangeHit", { ref, page: currentPageNumber(win), lines: group.length });
          flashed = true;
          return;
        }
        diag("fallback.visiblePageChangeMiss", { page: currentPageNumber(win), refs });
      }, delay);
    }
  }

  function clickReferences(citationHit) {
    return citationHit && !citationHit.rejected && citationHit.refs?.length
      ? citationHit.refs
      : [];
  }

  function passiveReferences(context, limit = 8) {
    return Heuristics.parseReferenceTriggers("", context).slice(0, limit);
  }

  function passiveReferencesNearPoint(win, x, y) {
    let all = visibleTextLines(win);
    let lines = all.filter((line) => y >= line.rect.top - 36 && y <= line.rect.bottom + 36);
    if (!lines.length) {
      lines = all.sort((a, b) => (
        Math.abs((a.rect.top + a.rect.bottom) / 2 - y)
        - Math.abs((b.rect.top + b.rect.bottom) / 2 - y)
      )).slice(0, 3);
    }
    let context = lines.map((line) => line.text).join(" ");
    let refs = passiveReferences(context);
    if (refs.length) diag("passiveRefs", { refs: refs.length, context: clip(context) });
    return refs;
  }

  function sourcePageGeometry(win, element, pageNumber) {
    let pageDiv = closest(element, ".page") || win.document.querySelector(`.page[data-page-number="${pageNumber}"]`);
    let app = unwrap(getPDFApplication(win));
    let pdfViewer = unwrap(app?.pdfViewer);
    let pageView = unwrap(pdfViewer?.getPageView?.(pageNumber - 1));
    let viewport = unwrap(pageView?.viewport);
    let rect = pageDiv?.getBoundingClientRect?.();
    if (!viewport?.convertToViewportPoint || !rect) return null;
    return {
      pageNumber,
      viewport,
      pageRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      }
    };
  }

  function pdfLineScreenRect(line, geometry) {
    let rect = null;
    for (let item of line.items || []) {
      if (!item.str) continue;
      let point = geometry.viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      let scale = geometry.viewport.scale || 1;
      let height = Math.max(8, (item.height || Math.abs(item.transform[3]) || 9) * scale);
      let width = Math.max(3, (item.width || item.str.length * 5) * scale);
      let itemRect = {
        left: geometry.pageRect.left + point[0],
        top: geometry.pageRect.top + point[1] - height,
        right: geometry.pageRect.left + point[0] + width,
        bottom: geometry.pageRect.top + point[1] + 2
      };
      rect = rect ? unionRects([rect, itemRect]) : itemRect;
    }
    return rect;
  }

  async function passiveReferencesFromPDFPoint(win, frameState, geometry, x, y) {
    if (!geometry) {
      diag("passivePdfRefs.miss", { reason: "no-geometry" });
      return [];
    }
    let pages = await getPDFTextPages(win, frameState);
    let page = pages.find((candidate) => candidate.pageNumber === geometry.pageNumber);
    if (!page) {
      diag("passivePdfRefs.miss", { reason: "no-page", page: geometry.pageNumber });
      return [];
    }

    let lines = itemLines(page).map((line) => ({
      line,
      rect: pdfLineScreenRect(line, geometry)
    })).filter((entry) => entry.rect);
    let nearby = lines.filter((entry) => (
      y >= entry.rect.top - 42
      && y <= entry.rect.bottom + 42
      && x >= entry.rect.left - 120
      && x <= entry.rect.right + 120
    ));
    if (!nearby.length) {
      nearby = lines.sort((a, b) => (
        Math.abs((a.rect.top + a.rect.bottom) / 2 - y)
        - Math.abs((b.rect.top + b.rect.bottom) / 2 - y)
      )).slice(0, 3);
    }

    let context = nearby.map((entry) => entry.line.text).join(" ");
    let refs = passiveReferences(context);
    if (refs.length) diag("passivePdfRefs", { refs: refs.length, context: clip(context) });
    else {
      refs = passiveReferences(page.text, 40);
      diag("passivePdfRefs.miss", { reason: "line-no-refs", lines: nearby.length, pageRefs: refs.length, context: clip(context) });
    }
    return refs;
  }

  function flashVisibleReference(win, refs) {
    for (let ref of refs || []) {
      let group = visibleReferenceGroup(win, ref);
      if (!group) continue;
      let baseRect = group[0].rect;
      let rects = group.map((line) => ({
        left: Math.min(baseRect.left, line.rect.left),
        top: line.rect.top,
        right: line.rect.right,
        bottom: line.rect.bottom
      })).filter((rect) => rect.right - rect.left > 2);
      flashRects(win, rects, 4200);
      diag("pageChangeReferenceHit", { ref, page: currentPageNumber(win), lines: group.length });
      return true;
    }
    return false;
  }

  function diagFallbackClick(click, refs, extra) {
    diag("fallback.click", Object.assign({
      page: click.beforePage,
      x: Math.round(click.x),
      y: Math.round(click.y),
      text: clip(click.text),
      context: clip(click.context),
      pointHit: !!click.citationHit?.refs?.length,
      refs
    }, extra || {}));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function getPDFTextPages(win, frameState) {
    let app = unwrap(getPDFApplication(win));
    let pdfDocument = unwrap(app?.pdfDocument);
    if (!pdfDocument?.numPages || !pdfDocument.getPage) return [];
    if (frameState.textCache?.pdfDocument === pdfDocument) {
      return frameState.textCache.pages;
    }

    let pages = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      let page = unwrap(await pdfDocument.getPage(pageNumber));
      let getTextContent = page?.getTextContent || page?.wrappedJSObject?.getTextContent;
      if (!getTextContent) {
        diag("getPDFTextPages.skipPage", { pageNumber, reason: "no-getTextContent" });
        continue;
      }
      let content = unwrap(await getTextContent.call(page));
      let items = Array.from(unwrap(content?.items) || []).map((item) => {
        item = unwrap(item);
        return {
          str: item.str || "",
          transform: Array.from(unwrap(item.transform) || []),
          width: item.width || 0,
          height: item.height || 0
        };
      });
      let text = Heuristics.cleanText(items.map((item) => item.str).join(" "));
      pages.push({ pageNumber, text, items });
    }

    frameState.textCache = { pdfDocument, pages };
    return pages;
  }

  function referenceStartIndex(pages) {
    if (pages.referenceStartIndex != null) return pages.referenceStartIndex;

    let explicit = pages.findIndex((page) => /\b(references|bibliography)\b/i.test(page.text));
    if (explicit >= 0) {
      pages.referenceStartIndex = explicit;
      return explicit;
    }

    let dense = pages.findIndex((page) => {
      if (page.pageNumber < 4) return false;
      let hits = page.text.match(/\b[A-Z][A-Za-z'\u2019.-]+\s+(?:et\s+al\.,?\s+)?(?:19|20)\d{2}\b/g);
      let numeric = page.text.match(/(?:^|\s)\[?\d{1,3}\]?\s+[A-Z][A-Za-z]/g);
      return (hits && hits.length >= 6) || (numeric && numeric.length >= 8);
    });
    pages.referenceStartIndex = dense >= 0 ? dense : Math.max(0, pages.length - 8);
    return pages.referenceStartIndex;
  }

  function itemLines(page) {
    if (page.lines) return page.lines;

    let raw = page.items
      .filter((item) => item.str && item.transform?.length >= 6)
      .map((item) => ({
        item,
        x: Number(item.transform[4]),
        y: Number(item.transform[5]),
        width: Number(item.width || 0),
        height: Number(item.height || Math.abs(item.transform[3]) || 9)
      }))
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));

    raw.sort((a, b) => b.y - a.y || a.x - b.x);

    let lines = [];
    for (let entry of raw) {
      let line = lines.find((candidate) => (
        Math.abs(candidate.y - entry.y) < 3
        && entry.x <= candidate.right + 18
        && entry.x >= candidate.left - 8
      ));
      if (!line) {
        line = { page, items: [], text: "", x: entry.x, y: entry.y, left: entry.x, right: entry.x + entry.width, height: entry.height };
        lines.push(line);
      }
      line.items.push(entry.item);
      line.text += (line.text ? " " : "") + entry.item.str;
      line.left = Math.min(line.left, entry.x);
      line.right = Math.max(line.right, entry.x + entry.width);
      line.height = Math.max(line.height, entry.height);
    }

    lines.sort((a, b) => b.y - a.y || a.left - b.left);
    page.lines = lines.map((line) => {
      line.text = Heuristics.cleanText(line.text);
      return line;
    }).filter((line) => line.text);
    return page.lines;
  }

  function samePdfColumn(base, line) {
    let overlap = Math.min(base.right, line.right) - Math.max(base.left, line.left);
    return overlap > 10 || Math.abs(base.left - line.left) < 36;
  }

  function numberedReferencePattern(number) {
    return new RegExp("(?:^|\\s)(?:\\[\\s*" + escapeRegExp(number) + "\\s*\\]|" + escapeRegExp(number) + "\\s*[.)])\\s+");
  }

  function referenceLineMatcher(ref) {
    if (ref.type === "number") {
      let pattern = numberedReferencePattern(ref.number);
      return (line) => pattern.test(line.text);
    }
    let author = new RegExp("\\b" + escapeRegExp(ref.author) + "\\b", "i");
    return (line) => author.test(line.text);
  }

  function collectReferenceLines(lines, index, ref) {
    let base = lines[index];
    let group = [base];
    let text = base.text;
    let maxLines = ref.type === "author-year" ? 10 : 6;
    for (let i = index + 1; i < lines.length && group.length < maxLines; i++) {
      let line = lines[i];
      if (Math.abs(line.y - base.y) < 3 && line.left > base.right + 24) continue;
      if (!samePdfColumn(base, line)) continue;
      if (group.length > 1 && looksLikeNextReferenceStart(base, line)) break;
      group.push(line);
      text += " " + line.text;
    }
    return group;
  }

  function looksLikeNextReferenceStart(base, line) {
    if (line.left > base.left + 7) return false;
    if (/^\d{1,4}$/.test(line.text)) return false;
    return looksLikeNumberedReferenceStart(line.text)
      || /^[A-Z][A-Za-z'\u2019.-]+(?:-[A-Z][A-Za-z'\u2019.-]+)?\s+(?:[A-Z](?:[A-Za-z'\u2019.-]+|\.)?|and\b)/.test(line.text);
  }

  function looksLikeNumberedReferenceStart(text) {
    return /^(?:\[\s*\d{1,3}\s*\]|\d{1,3}[.)])\s+\S/.test(text);
  }

  function referenceText(group) {
    return group.map((line) => line.text).join(" ");
  }

  function expectedReferenceYear(ref) {
    return ref.year ? ref.year + (ref.suffix || "") : "";
  }

  function shouldTryNextPage(lines, index, group) {
    return index + group.length >= lines.length - 3;
  }

  function appendNextPageReferenceLines(pages, pageIndex, lines, index, group, ref) {
    let expectedYear = expectedReferenceYear(ref);
    let text = referenceText(group);
    if (!expectedYear || text.includes(expectedYear)) return group;
    if (!shouldTryNextPage(lines, index, group)) return group;

    let nextPage = pages[pageIndex + 1];
    if (!nextPage) return group;

    let base = group[0];
    let originalLength = group.length;
    for (let line of itemLines(nextPage)) {
      if (/^\d{1,4}$/.test(line.text)) continue;
      if (group.length > originalLength && line.left <= base.left + 4) break;
      if (group.length >= 10) break;

      group.push(line);
      text += " " + line.text;
      if (text.includes(expectedYear)) {
        diag("fallback.crossPageReference", {
          ref,
          from: base.page.pageNumber,
          to: nextPage.pageNumber,
          lines: group.length
        });
        break;
      }
    }
    return group;
  }

  function findReferenceMatch(pages, ref) {
    if (!pages.length) return null;
    let start = referenceStartIndex(pages);
    let matchesLine = referenceLineMatcher(ref);
    for (let pageIndex = start; pageIndex < pages.length; pageIndex++) {
      let page = pages[pageIndex];
      let lines = itemLines(page);
      for (let i = 0; i < lines.length; i++) {
        if (!matchesLine(lines[i])) continue;
        let group = appendNextPageReferenceLines(pages, pageIndex, lines, i, collectReferenceLines(lines, i, ref), ref);
        let text = referenceText(group);
        let expectedYear = expectedReferenceYear(ref);
        if (expectedYear && !text.includes(expectedYear)) continue;
        return { page, lines: group };
      }
    }
    return null;
  }

  async function navigateToPage(win, pageNumber, { history = false } = {}) {
    if (history) {
      try {
        let view = await prepareZoteroHistory(win);
        if (view?.navigate) {
          await view.navigate({ pageIndex: pageNumber - 1 });
          diag("history.page", { page: pageNumber });
          return true;
        }
      }
      catch (e) {
        diag("history.pageError", { page: pageNumber, message: String(e) });
      }
    }

    let app = unwrap(getPDFApplication(win));
    let linkService = unwrap(app?.pdfLinkService || app?.linkService);
    if (history && linkService?.goToPage) {
      linkService.goToPage(pageNumber);
      return true;
    }

    let pdfViewer = unwrap(app?.pdfViewer);
    if (pdfViewer?.scrollPageIntoView) {
      pdfViewer.scrollPageIntoView({ pageNumber });
      return true;
    }
    if (pdfViewer && "currentPageNumber" in pdfViewer) {
      pdfViewer.currentPageNumber = pageNumber;
      return true;
    }
    if (app && "page" in app) {
      app.page = pageNumber;
      return true;
    }
    return false;
  }

  function lineRects(win, match) {
    let app = unwrap(getPDFApplication(win));
    let pdfViewer = unwrap(app?.pdfViewer);
    return match.lines.map((line) => {
      let pageNumber = line.page?.pageNumber || match.page.pageNumber;
      let pageView = unwrap(pdfViewer?.getPageView?.(pageNumber - 1));
      let viewport = unwrap(pageView?.viewport);
      let pageDiv = pageView?.div || win.document.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!viewport?.convertToViewportPoint || !pageDiv) return null;

      let pageRect = pageDiv.getBoundingClientRect();
      let rect = null;
      for (let item of line.items) {
        if (!item.transform?.length) continue;
        let point = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        let scale = viewport.scale || 1;
        let height = Math.max(8, (item.height || Math.abs(item.transform[3]) || 9) * scale);
        let width = Math.max(3, (item.width || item.str.length * 5) * scale);
        let itemRect = {
          left: pageRect.left + point[0],
          top: pageRect.top + point[1] - height,
          right: pageRect.left + point[0] + width,
          bottom: pageRect.top + point[1] + 3
        };
        rect = rect ? {
          left: Math.min(rect.left, itemRect.left),
          top: Math.min(rect.top, itemRect.top),
          right: Math.max(rect.right, itemRect.right),
          bottom: Math.max(rect.bottom, itemRect.bottom)
        } : itemRect;
      }
      return rect;
    }).filter((rect) => rect && rect.bottom >= 55 && rect.top <= win.innerHeight - 15);
  }

  function scrollToMatch(win, match) {
    let app = unwrap(getPDFApplication(win));
    let pdfViewer = unwrap(app?.pdfViewer);
    let first = match.lines[0]?.items?.[0];
    let pageNumber = match.lines[0]?.page?.pageNumber || match.page.pageNumber;
    let pageView = unwrap(pdfViewer?.getPageView?.(pageNumber - 1));
    let viewport = unwrap(pageView?.viewport);
    let pageDiv = pageView?.div || win.document.querySelector(`.page[data-page-number="${pageNumber}"]`);
    if (!viewport?.convertToViewportPoint || !pageDiv || !first?.transform?.length) return false;

    let point = viewport.convertToViewportPoint(first.transform[4], first.transform[5]);
    let root = getScrollRoot(win.document);
    let top = pageDiv.offsetTop + point[1] - win.innerHeight * 0.30;
    if (root?.scrollTo) {
      root.scrollTo({ top: Math.max(0, top), left: root.scrollLeft || 0, behavior: "auto" });
    }
    else if (root) {
      root.scrollTop = Math.max(0, top);
    }
    else {
      win.scrollTo(0, Math.max(0, top));
    }
    return true;
  }

  function scheduleMatchHighlight(win, frameState, match, clickId) {
    let scrolled = false;
    let flashed = false;
    for (let delay of [0, 120, 420, 900]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
        if (flashed) return;
        if (!scrolled) {
          scrolled = scrollToMatch(win, match);
        }
        afterPaint(win, () => {
          if (frameState.clickId !== clickId) return;
          if (flashed) return;
          let rects = lineRects(win, match);
          if (rects.length) {
            flashRects(win, rects, 4200);
            flashed = true;
            return;
          }
          if (currentPageNumber(win) !== match.page.pageNumber) {
            navigateToPage(win, match.page.pageNumber).then((ok) => {
              if (!ok || frameState.clickId !== clickId) return;
              if (flashed) return;
              scrolled = scrollToMatch(win, match);
              let retryRects = lineRects(win, match);
              if (retryRects.length) {
                flashRects(win, retryRects, 4200);
                flashed = true;
              }
            });
            return;
          }
          diag("fallback.flashMiss", {
            page: match.page.pageNumber,
            current: currentPageNumber(win),
            delay,
            scrolled
          });
        });
      }, delay);
    }
  }

  async function resolveFallback(win, frameState, refs, clickId, beforePage, { nativePending = false } = {}) {
    if (nativePending) await wait(win, 70);
    if (frameState.clickId !== clickId) return;
    let currentPage = currentPageNumber(win);
    let nativeChangedTo = null;
    if (beforePage && currentPage && currentPage !== beforePage) {
      diag("fallback.skipNativePageChange", { from: beforePage, to: currentPage, refs });
      nativeChangedTo = currentPage;
    }

    let pages = await getPDFTextPages(win, frameState);
    if (frameState.clickId !== clickId) return;
    currentPage = currentPageNumber(win);
    if (!nativeChangedTo && beforePage && currentPage && currentPage !== beforePage) {
      diag("fallback.lateNativePageChange", { from: beforePage, to: currentPage, refs });
      nativeChangedTo = currentPage;
    }

    for (let ref of refs) {
      let match = findReferenceMatch(pages, ref);
      if (!match) {
        diag("fallback.miss", { ref });
        continue;
      }
      if (nativeChangedTo && match.page.pageNumber !== nativeChangedTo) {
        diag("fallback.nativePageChangeMismatch", { ref, nativePage: nativeChangedTo, matchPage: match.page.pageNumber });
        continue;
      }
      if (!nativeChangedTo && !(await navigateToPage(win, match.page.pageNumber, { history: true }))) {
        diag("fallback.miss", { ref });
        continue;
      }

      diag(nativeChangedTo ? "fallback.nativePageChangeHit" : "fallback.hit", { ref, page: match.page.pageNumber, lines: match.lines.length });
      scheduleMatchHighlight(win, frameState, match, clickId);
      return;
    }

    if (nativeChangedTo) {
      scheduleVisibleReferenceHighlight(win, frameState, refs, clickId, nativeChangedTo);
    }
  }

  async function passiveClickReferences(win, frameState, click) {
    if (click.passiveRefs?.length) return click.passiveRefs;
    try {
      return await passiveReferencesFromPDFPoint(win, frameState, click.sourceGeometry, click.x, click.y);
    }
    catch (e) {
      diag("passivePdfRefs.error", { message: String(e) });
      return [];
    }
  }

  async function resolveNonDomClick(win, frameState, click, logError) {
    if (click.citationHit?.rejected) {
      diag("fallback.pointReject", {
        page: click.beforePage,
        x: Math.round(click.x),
        y: Math.round(click.y),
        candidates: click.citationHit.candidates,
        context: clip(click.citationHit.context)
      });
      schedulePageChangeHighlight(win, frameState, click.clickId, click.beforePage, await passiveClickReferences(win, frameState, click));
      return;
    }

    if (Heuristics.shouldBlock(click.text, click.context)) {
      diag("fallback.block", { page: click.beforePage, text: clip(click.text), context: clip(click.context) });
      return;
    }

    let refs = clickReferences(click.citationHit);
    if (!refs.length) return;

    let nativeLink = null;
    try {
      nativeLink = await nativeAnnotationAtPoint(win, click.x, click.y, click.element);
    }
    catch (e) {
      diag("nativeAnnotation.error", { message: String(e) });
    }
    if (frameState.clickId !== click.clickId) return;

    if (nativeLink) {
      diag("nativeLink.click", {
        page: click.beforePage,
        href: clip(nativeLink.href, 220),
        dest: typeof nativeLink.dest === "string" ? nativeLink.dest : !!nativeLink.dest,
        direct: nativeLink.direct,
        source: nativeLink.source || "dom"
      });
      openNativeDestination(win, nativeLink.dest, { history: true }).catch(logError);
      diagFallbackClick(click, refs, { native: true });
      await resolveFallback(win, frameState, refs, click.clickId, click.beforePage, { nativePending: true });
      return;
    }

    diagFallbackClick(click, refs);
    await resolveFallback(win, frameState, refs, click.clickId, click.beforePage);
  }

  async function resolveUnrecognizedClick(win, frameState, click) {
    let nativeLink = null;
    try {
      nativeLink = await nativeAnnotationAtPoint(win, click.x, click.y, click.element);
    }
    catch (e) {
      diag("nativeAnnotation.error", { message: String(e) });
    }
    if (frameState.clickId !== click.clickId) return;

    if (nativeLink?.dest) {
      diag("nativeAnnotation.noCitation", {
        page: click.beforePage,
        href: clip(nativeLink.href, 220),
        dest: typeof nativeLink.dest === "string" ? nativeLink.dest : !!nativeLink.dest
      });
    }

    schedulePageChangeHighlight(win, frameState, click.clickId, click.beforePage, await passiveClickReferences(win, frameState, click));
  }

  function removeOverlays(doc) {
    for (let overlay of doc.querySelectorAll("." + OVERLAY_CLASS)) {
      overlay.remove();
    }
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
      try {
        Zotero.debug("Reference Guard: " + message);
      }
      catch (_) {}
    },

    addToAllWindows() {
      let seen = new Set();
      let count = 0;
      if (typeof Zotero !== "undefined" && Zotero.getMainWindows) {
        for (let win of Zotero.getMainWindows()) {
          seen.add(win);
          count++;
          this.addToWindow(win);
        }
      }
      if (typeof Services !== "undefined" && Services.wm) {
        let enumerator = Services.wm.getEnumerator(null);
        while (enumerator.hasMoreElements()) {
          let win = enumerator.getNext();
          if (!seen.has(win)) {
            count++;
            this.addToWindow(win);
          }
        }
      }
      diag("addToAllWindows", { count });
    },

    removeFromAllWindows() {
      let seen = new Set();
      if (typeof Zotero !== "undefined" && Zotero.getMainWindows) {
        for (let win of Zotero.getMainWindows()) {
          seen.add(win);
          this.removeFromWindow(win);
        }
      }
      if (typeof Services !== "undefined" && Services.wm) {
        let enumerator = Services.wm.getEnumerator(null);
        while (enumerator.hasMoreElements()) {
          let win = enumerator.getNext();
          if (!seen.has(win)) this.removeFromWindow(win);
        }
      }
    },

    addToWindow(win) {
      if (!win?.document) {
        diag("addToWindow.skip", { reason: "no-document" });
        return;
      }
      if (this.windows.has(win)) {
        diag("addToWindow.skip", { reason: "already-added", title: clip(win.document.title) });
        return;
      }

      diag("addToWindow", { title: clip(win.document.title), url: clip(win.document.URL, 220) });

      let scan = () => this.scanWindow(win);
      let observer = new win.MutationObserver(scan);
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
      win.addEventListener("load", scan, true);
      let scanAttempts = 0;
      let scanTimer = win.setInterval(() => {
        scan();
        scanAttempts++;
        if (scanAttempts >= 30) {
          win.clearInterval(scanTimer);
          let entry = this.windows.get(win);
          if (entry) entry.scanTimer = null;
        }
      }, 1000);
      // ponytail: bounded startup retry; MutationObserver/load handle later reader changes.
      this.windows.set(win, { observer, scan, scanTimer, frames: new Set() });
      scan();
    },

    removeFromWindow(win) {
      let entry = this.windows.get(win);
      if (!entry) return;

      entry.observer.disconnect();
      win.removeEventListener("load", entry.scan, true);
      if (entry.scanTimer) win.clearInterval(entry.scanTimer);
      for (let frameWin of entry.frames) {
        this.removeFromFrame(frameWin);
      }
      this.windows.delete(win);
    },

    scanWindow(win) {
      this.scanFrameTree(win, win, 0, new Set());
    },

    scanFrameTree(win, parentWin, depth, seen) {
      if (!win?.document || seen.has(win.document) || depth > 5) return;
      seen.add(win.document);

      let frames = Array.from(win.document.querySelectorAll("iframe, browser"));
      diag("scanFrameTree", {
        depth,
        title: clip(win.document.title),
        url: clip(win.document.URL, 220),
        hasReaderRoot: !!win.document.querySelector(".textLayer, #viewerContainer, .pdfViewer"),
        frames: frames.map((frame) => ({
          tag: frame.tagName,
          id: frame.id || "",
          className: clip(frame.className, 80),
          src: clip(frame.getAttribute("src") || frame.currentURI?.spec || frame.src || "", 180)
        })).slice(0, 20)
      });
      this.addToFrame(win, parentWin);

      for (let frame of frames) {
        let frameWin;
        try {
          frameWin = frame.contentWindow;
        }
        catch (_) {
          diag("scanFrame.skip", { reason: "contentWindow-throws", tag: frame.tagName, id: frame.id || "" });
          continue;
        }
        if (frameWin?.document) {
          this.scanFrameTree(frameWin, parentWin, depth + 1, seen);
        }
        else {
          diag("scanFrame.skip", { reason: "no-frame-document", tag: frame.tagName, id: frame.id || "" });
        }
      }
    },

    addToFrame(win, parentWin) {
      let doc = win.document;
      if (!doc?.documentElement) {
        diag("addToFrame.skip", { reason: "no-documentElement" });
        return;
      }
      if (doc.documentElement.hasAttribute(INSTALLED_ATTR)) {
        diag("addToFrame.skip", { reason: "already-installed", url: clip(doc.URL, 220) });
        return;
      }
      if (!doc.querySelector(".textLayer, #viewerContainer, .pdfViewer")) {
        diag("addToFrame.skip", {
          reason: "no-reader-elements",
          title: clip(doc.title),
          url: clip(doc.URL, 220),
          bodyClass: clip(doc.body?.className, 120)
        });
        return;
      }
      let app = unwrap(getPDFApplication(win));
      if (!app?.pdfViewer || !app?.pdfDocument) {
        diag("addToFrame.skip", {
          reason: "pdf-app-not-ready",
          title: clip(doc.title),
          url: clip(doc.URL, 220),
          hasPdfApp: !!app,
          hasPdfViewer: !!app?.pdfViewer,
          hasPdfDocument: !!app?.pdfDocument,
          page: currentPageNumber(win)
        });
        return;
      }

      doc.documentElement.setAttribute(INSTALLED_ATTR, "true");

      let style = doc.createElement("link");
      style.id = CSS_ID;
      style.rel = "stylesheet";
      style.type = "text/css";
      style.href = this.rootURI + "src/ref-guard.css";
      (doc.head || doc.documentElement).appendChild(style);

      let frameState = {
        win,
        lastClickAt: 0,
        clickId: 0,
        textCache: null
      };

      let handler = (event) => {
        let element = elementFromTarget(event.target);
        if (!element || closest(element, "input, textarea, button, select, [contenteditable='true'], .toolbar, .popup, .sidebar")) {
          return;
        }

        let nativeLink = nativeLinkAtPoint(win, event.clientX, event.clientY, element);
        if (nativeLink) {
          let citationHit = citationHitAtPoint(win, event.clientX, event.clientY);
          let refs = clickReferences(citationHit);
          if (!refs.length) {
            let clickId = ++frameState.clickId;
            let beforePage = currentPageNumber(win);
            let click = {
              clickId,
              beforePage,
              x: event.clientX,
              y: event.clientY,
              element,
              passiveRefs: citationHit?.context ? passiveReferences(citationHit.context, 40) : passiveReferencesNearPoint(win, event.clientX, event.clientY),
              sourceGeometry: sourcePageGeometry(win, element, beforePage)
            };
            diag("nativeLink.noCitation", {
              page: beforePage,
              href: clip(nativeLink.href, 220),
              dest: typeof nativeLink.dest === "string" ? nativeLink.dest : !!nativeLink.dest,
              direct: nativeLink.direct,
              rejected: !!citationHit?.rejected
            });
            passiveClickReferences(win, frameState, click)
              .then((passiveRefs) => schedulePageChangeHighlight(win, frameState, clickId, beforePage, passiveRefs))
              .catch((e) => this.log(e));
            return;
          }

          let text = citationHit.text;
          let context = citationHit?.context || "";
          let beforePage = currentPageNumber(win);
          let clickId = ++frameState.clickId;
          diag("nativeLink.click", {
            page: beforePage,
            href: clip(nativeLink.href, 220),
            dest: typeof nativeLink.dest === "string" ? nativeLink.dest : !!nativeLink.dest,
            direct: nativeLink.direct,
            source: "dom"
          });
          if (nativeLink.dest) {
            event.preventDefault();
            event.stopPropagation();
            openNativeDestination(win, nativeLink.dest, { history: true }).catch((e) => this.log(e));
          }
          else if (!nativeLink.direct) {
            openNativeDestination(win, nativeLink.dest).catch((e) => this.log(e));
          }
          diagFallbackClick({
            beforePage,
            x: event.clientX,
            y: event.clientY,
            text,
            context,
            citationHit
          }, refs, { native: true });
          resolveFallback(win, frameState, refs, clickId, beforePage, { nativePending: true }).catch((e) => this.log(e));
          return;
        }

        let now = Date.now();
        if (now - frameState.lastClickAt < 250) return;
        frameState.lastClickAt = now;

        let citationHit = citationHitAtPoint(win, event.clientX, event.clientY);
        if (!citationHit) {
          let clickId = ++frameState.clickId;
          let beforePage = currentPageNumber(win);
          resolveUnrecognizedClick(win, frameState, {
            clickId,
            beforePage,
            x: event.clientX,
            y: event.clientY,
            element,
            passiveRefs: passiveReferencesNearPoint(win, event.clientX, event.clientY),
            sourceGeometry: sourcePageGeometry(win, element, beforePage)
          }).catch((e) => this.log(e));
          return;
        }
        let text = citationHit.rejected ? "" : citationHit.text;
        let context = citationHit.context || "";
        let clickId = ++frameState.clickId;
        resolveNonDomClick(win, frameState, {
          clickId,
          beforePage: currentPageNumber(win),
          x: event.clientX,
          y: event.clientY,
          element,
          text,
          context,
          citationHit,
          passiveRefs: passiveReferences(citationHit.context),
          sourceGeometry: sourcePageGeometry(win, element, currentPageNumber(win))
        }, (e) => this.log(e)).catch((e) => this.log(e));
      };

      for (let type of EVENT_TYPES) {
        doc.addEventListener(type, handler, true);
      }

      this.frames.set(win, { doc, handler });
      this.windows.get(parentWin)?.frames.add(win);
      diag("attach", {
        version: this.version,
        codeVersion: CODE_VERSION,
        url: clip(doc.URL, 220),
        hasTextLayer: !!doc.querySelector(".textLayer"),
        hasViewerContainer: !!doc.getElementById("viewerContainer"),
        hasPdfViewer: !!doc.querySelector(".pdfViewer"),
        page: currentPageNumber(win),
        hasPdfApp: !!getPDFApplication(win)
      });
    },

    removeFromFrame(win) {
      let entry = this.frames.get(win);
      if (!entry) return;

      for (let type of EVENT_TYPES) {
        entry.doc.removeEventListener(type, entry.handler, true);
      }
      entry.doc.getElementById(CSS_ID)?.remove();
      entry.doc.documentElement?.removeAttribute(INSTALLED_ATTR);
      removeOverlays(entry.doc);
      this.frames.delete(win);
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      ReferenceGuardHeuristics: Heuristics,
      ReferenceGuardTestHooks: { clickReferences, findReferenceMatch, itemLines }
    };
  }
})();
