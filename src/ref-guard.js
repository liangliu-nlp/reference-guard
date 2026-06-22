(function () {
  const CODE_VERSION = "0.2.27";
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
    },

    shouldUseContextForTrigger(text) {
      text = this.cleanText(text);
      if (!text || text.length > 140) return false;
      return this.isCitationLike(text, "")
        || /\bet\s+al\./i.test(text)
        || /(?:19|20)\d{2}[a-z]?/.test(text)
        || /^[\s\d,;()[\].\-\u2013\u2014]+$/.test(text);
    },

    parseClickReferences(text, context) {
      let refs = this.parseReferenceTriggers(text, "");
      if (refs.length) {
        if (refs.some((ref) => ref.type === "author-year" && !ref.year) && this.shouldUseContextForTrigger(text)) {
          let contextRefs = this.parseReferenceTriggers(context, "");
          let completed = refs.map((ref) => {
            if (ref.type !== "author-year" || ref.year) return ref;
            return contextRefs.find((candidate) => (
              candidate.type === "author-year"
              && candidate.year
              && candidate.author.toLowerCase() === ref.author.toLowerCase()
            )) || ref;
          });
          if (completed.some((ref, index) => ref !== refs[index])) return completed;
        }
        return refs;
      }
      if (!this.shouldUseContextForTrigger(text)) return [];
      return this.parseReferenceTriggers(text, context);
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

  function nearestTextElement(element) {
    return closest(element, ".textLayer span, .textLayer div, span") || element;
  }

  function getContext(element) {
    let pieces = [];
    let node = nearestTextElement(element);
    if (!node) return "";

    let length = 0;
    for (let current = node.previousSibling; current && length < 160; current = current.previousSibling) {
      let piece = current.textContent || "";
      pieces.unshift(piece);
      length += piece.length + 1;
    }

    let ownText = node.textContent || "";
    pieces.push(ownText);
    length += ownText.length + 1;

    for (let current = node.nextSibling; current && length < 320; current = current.nextSibling) {
      let piece = current.textContent || "";
      pieces.push(piece);
      length += piece.length + 1;
    }

    let text = Heuristics.cleanText(pieces.join(" "));
    if (text.length < 12 && node.parentElement?.textContent?.length < 360) {
      text = Heuristics.cleanText(node.parentElement.textContent);
    }
    return text;
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

  function getPointContext(win, x, y) {
    let pieces = [];
    for (let element of win.document.elementsFromPoint?.(x, y) || []) {
      let text = Heuristics.cleanText(element.textContent || element.getAttribute?.("aria-label") || element.title || "");
      if (text && text.length < 500) pieces.push(text);
    }

    let lines = visibleTextLines(win);
    let index = lines.findIndex((line) => (
      y >= line.rect.top - 8
      && y <= line.rect.bottom + 8
      && x >= line.rect.left - 24
      && x <= line.rect.right + 24
    ));
    if (index >= 0) {
      pieces.push(lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).map((line) => line.text).join(" "));
    }

    return Heuristics.cleanText(pieces.join(" "));
  }

  function combinedContext(win, event, element) {
    return Heuristics.cleanText(`${getContext(element)} ${getPointContext(win, event.clientX, event.clientY)}`);
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

  function eventText(event) {
    let element = elementFromTarget(event.target);
    let node = nearestTextElement(element);
    let text = Heuristics.cleanText(node?.textContent || element?.textContent || "");
    if (text.length > 220) return "";
    return text;
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

    let pageRect = pageDiv.getBoundingClientRect();
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

  function flashLines(win, lines, duration) {
    flashRects(win, lines.map((line) => line.rect).filter(Boolean), duration);
  }

  function sameColumn(base, line) {
    let overlap = Math.min(base.rect.right, line.rect.right) - Math.max(base.rect.left, line.rect.left);
    return overlap > 12 || Math.abs(base.rect.left - line.rect.left) < 36;
  }

  function flashLanding(win) {
    let lines = visibleTextLines(win);
    if (!lines.length) return false;

    let targetY = win.innerHeight * 0.30;
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < lines.length; i++) {
      let score = Math.abs(lines[i].rect.top - targetY);
      if (lines[i].rect.top < 55) score += 100;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    let base = lines[bestIndex];
    let group = [base];
    for (let i = bestIndex + 1; i < lines.length && group.length < 3; i++) {
      if (sameColumn(base, lines[i])) group.push(lines[i]);
    }
    flashLines(win, group, 3200);
    diag("flashLanding", { page: currentPageNumber(win), lines: group.length });
    return true;
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

  function destinationPoint(win, resolved) {
    let app = unwrap(getPDFApplication(win));
    let pdfViewer = unwrap(app?.pdfViewer);
    let pageView = unwrap(pdfViewer?.getPageView?.(resolved.pageNumber - 1));
    let viewport = unwrap(pageView?.viewport);
    let pageDiv = pageView?.div || win.document.querySelector(`.page[data-page-number="${resolved.pageNumber}"]`);
    if (!viewport?.convertToViewportPoint || !pageDiv) return null;

    let dest = resolved.destArray;
    let destType = unwrap(dest[1]);
    let type = destType?.name || String(destType || "").replace("/", "");
    let x = 0;
    let y = null;

    if (type === "XYZ") {
      x = typeof dest[2] === "number" ? dest[2] : 0;
      y = typeof dest[3] === "number" ? dest[3] : null;
    }
    else if (type === "FitH" || type === "FitBH") {
      y = typeof dest[2] === "number" ? dest[2] : null;
    }
    else if (type === "FitR") {
      x = typeof dest[2] === "number" ? dest[2] : 0;
      y = typeof dest[3] === "number" ? dest[3] : null;
    }
    if (y === null) return null;

    let point = viewport.convertToViewportPoint(x, y);
    let pageRect = pageDiv.getBoundingClientRect();
    return {
      x: pageRect.left + point[0],
      y: pageRect.top + point[1],
      pageDiv
    };
  }

  function rectVisible(win, rect) {
    return !!rect
      && rect.bottom >= 55
      && rect.top <= win.innerHeight - 15
      && rect.right >= 0
      && rect.left <= win.innerWidth;
  }

  function flashDestination(win, resolved) {
    if (!resolved) return false;

    let point = destinationPoint(win, resolved);
    if (!point) return flashLanding(win);
    if (!rectVisible(win, point.pageDiv.getBoundingClientRect())) return false;

    let lines = pageTextLines(win, resolved.pageNumber).filter((line) => (
      line.rect.bottom >= 55
      && line.rect.top <= win.innerHeight - 15
      && line.page === point.pageDiv
    ));
    if (!lines.length) {
      flashRects(win, [{
        left: point.x,
        top: point.y - 12,
        right: point.x + Math.min(360, win.innerWidth * 0.5),
        bottom: point.y + 28
      }], 3200);
      return true;
    }

    let bestIndex = 0;
    let bestScore = Infinity;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let yScore = Math.abs(line.rect.top - point.y);
      let xScore = point.x > line.rect.right + 24 || point.x < line.rect.left - 80 ? 35 : 0;
      let score = yScore + xScore;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    let base = lines[bestIndex];
    let group = [base];
    for (let i = bestIndex + 1; i < lines.length && group.length < 4; i++) {
      if (sameColumn(base, lines[i])) group.push(lines[i]);
    }
    flashLines(win, group, 3600);
    diag("flashDestination", { page: resolved.pageNumber, lines: group.length });
    return true;
  }

  async function scheduleNativeHighlight(win, frameState, dest, clickId) {
    let resolved = null;
    try {
      resolved = await resolveDestination(win, dest);
    }
    catch (e) {
      diag("nativeDest.resolveError", { message: String(e) });
    }

    for (let delay of [180, 420, 900, 1500]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
        if (resolved && flashDestination(win, resolved)) return;
        if (!resolved) flashLanding(win);
      }, delay);
    }
  }

  async function openNativeDestination(win, dest) {
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

  function scheduleLandingHighlight(win, frameState, clickId, expectedPage) {
    for (let delay of [120, 420, 900]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
        if (expectedPage && currentPageNumber(win) !== expectedPage) return;
        flashLanding(win);
      }, delay);
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
    for (let delay of [140, 420, 900]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
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
          return;
        }
        diag("fallback.visiblePageChangeMiss", { page: currentPageNumber(win), refs });
      }, delay);
    }
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
    for (let i = index + 1; i < lines.length && group.length < 6; i++) {
      let line = lines[i];
      if (Math.abs(line.y - base.y) < 3 && line.left > base.right + 24) continue;
      if (!samePdfColumn(base, line)) continue;
      if (group.length > 1 && looksLikeNextReferenceStart(base, line)) break;
      group.push(line);
      text += " " + line.text;
      if (ref.year && text.includes(ref.year)) break;
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

  function navigateToPage(win, pageNumber) {
    let app = unwrap(getPDFApplication(win));
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
    for (let delay of [160, 420, 900, 1500]) {
      win.setTimeout(() => {
        if (frameState.clickId !== clickId) return;
        if (!scrolled) {
          scrolled = scrollToMatch(win, match);
        }
        afterPaint(win, () => {
          if (frameState.clickId !== clickId) return;
          let rects = lineRects(win, match);
          if (rects.length) {
            flashRects(win, rects, 4200);
            return;
          }
          if (currentPageNumber(win) !== match.page.pageNumber && navigateToPage(win, match.page.pageNumber)) {
            scrolled = scrollToMatch(win, match);
            let retryRects = lineRects(win, match);
            if (retryRects.length) {
              flashRects(win, retryRects, 4200);
              return;
            }
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

  async function resolveFallback(win, frameState, refs, clickId, beforePage) {
    await wait(win, 220);
    if (frameState.clickId !== clickId) return;
    let currentPage = currentPageNumber(win);
    let nativeChangedTo = null;
    if (beforePage && currentPage && currentPage !== beforePage) {
      diag("fallback.skipNativePageChange", { from: beforePage, to: currentPage, refs });
      nativeChangedTo = currentPage;
    }

    let pages = await getPDFTextPages(win, frameState);
    if (frameState.clickId !== clickId) return;

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
      if (!nativeChangedTo && !navigateToPage(win, match.page.pageNumber)) {
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

  async function resolveNonDomClick(win, frameState, click, logError) {
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
      openNativeDestination(win, nativeLink.dest).catch(logError);
      scheduleNativeHighlight(win, frameState, nativeLink.dest, click.clickId).catch(logError);
      return;
    }

    if (click.citationHit?.rejected) {
      diag("fallback.pointReject", {
        page: click.beforePage,
        x: Math.round(click.x),
        y: Math.round(click.y),
        candidates: click.citationHit.candidates,
        context: clip(click.citationHit.context)
      });
      return;
    }

    if (Heuristics.shouldBlock(click.text, click.context)) {
      diag("fallback.block", { page: click.beforePage, text: clip(click.text), context: clip(click.context) });
      return;
    }

    let refs = click.citationHit?.refs?.length
      ? click.citationHit.refs
      : Heuristics.parseClickReferences(click.text, click.context);
    if (!refs.length) return;

    diag("fallback.click", {
      page: click.beforePage,
      x: Math.round(click.x),
      y: Math.round(click.y),
      text: clip(click.text),
      context: clip(click.context),
      pointHit: !!click.citationHit?.refs?.length,
      refs
    });
    await resolveFallback(win, frameState, refs, click.clickId, click.beforePage);
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
      let scanTimer = win.setInterval(scan, 1000);
      this.windows.set(win, { observer, scan, scanTimer, frames: new Set() });
      scan();
    },

    removeFromWindow(win) {
      let entry = this.windows.get(win);
      if (!entry) return;

      entry.observer.disconnect();
      win.removeEventListener("load", entry.scan, true);
      win.clearInterval(entry.scanTimer);
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
          let clickId = ++frameState.clickId;
          diag("nativeLink.click", {
            page: currentPageNumber(win),
            href: clip(nativeLink.href, 220),
            dest: typeof nativeLink.dest === "string" ? nativeLink.dest : !!nativeLink.dest,
            direct: nativeLink.direct,
            source: "dom"
          });
          if (!nativeLink.direct) {
            openNativeDestination(win, nativeLink.dest).catch((e) => this.log(e));
          }
          scheduleNativeHighlight(win, frameState, nativeLink.dest, clickId).catch((e) => this.log(e));
          return;
        }

        let now = Date.now();
        if (now - frameState.lastClickAt < 250) return;
        frameState.lastClickAt = now;

        let citationHit = citationHitAtPoint(win, event.clientX, event.clientY);
        let text = citationHit && !citationHit.rejected ? citationHit.text : eventText(event);
        let context = citationHit?.context || combinedContext(win, event, element);
        let clickId = ++frameState.clickId;
        resolveNonDomClick(win, frameState, {
          clickId,
          beforePage: currentPageNumber(win),
          x: event.clientX,
          y: event.clientY,
          element,
          text,
          context,
          citationHit
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
      ReferenceGuardTestHooks: { findReferenceMatch, itemLines }
    };
  }
})();
