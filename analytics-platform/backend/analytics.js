(function () {
  "use strict";
  try {
    // ── Config ──────────────────────────────────────────────────────────────
    var scriptEl =
      document.currentScript ||
      document.querySelector("script[data-project-id][src*='analytics']") ||
      document.querySelector("script[data-project-id]");

    var PROJECT_ID = scriptEl && scriptEl.getAttribute("data-project-id");
    // data-endpoint should point to the backend root, e.g. "https://your-api.com/api"
    var BASE_URL = ((scriptEl && scriptEl.getAttribute("data-endpoint")) || "").replace(/\/+$/, "");

    if (!PROJECT_ID || !BASE_URL) return;

    // Guard against duplicate injection (e.g. SPA re-renders)
    if (typeof window.__analyticsTrackerInitByProject === "undefined") {
      window.__analyticsTrackerInitByProject = {};
    }
    if (window.__analyticsTrackerInitByProject[PROJECT_ID]) return;
    window.__analyticsTrackerInitByProject[PROJECT_ID] = true;

    // ── Constants ────────────────────────────────────────────────────────────
    var USER_ID_KEY    = "analytics_user_id";
    var SESSION_ID_KEY = "analytics_session_id";
    var USER_PROPS_KEY = "analytics_user_properties";

    var EVT_BATCH_SIZE    = 10;
    var EVT_FLUSH_MS      = 2000;
    var CLICK_DEBOUNCE_MS = 150;
    var ROUTE_DEBOUNCE_MS = 250;
    var RAGE_WINDOW_MS    = 1000;
    var RAGE_CLICK_COUNT  = 3;
    var RAGE_AREA_PX      = 48;

    var HM_CLICK_MAX      = 50;
    var HM_CLICK_FLUSH_MS = 5000;
    var HM_HOVER_SAMPLE   = 250;
    var HM_HOVER_MIN_DIST = 24;
    var HM_HOVER_MAX      = 120;
    var HM_HOVER_FLUSH_MS = 5000;
    var HM_SCROLL_THROTTLE = 2000;
    var HM_SCROLL_THRESH  = 5;

    var SNAP_DEBOUNCE_MS  = 1200;
    var SNAP_MIN_MS       = 8000;

    var SR_FLUSH_MS       = 5000;
    var SR_MAX_DURATION   = 30 * 60 * 1000;   // 30 min
    var SR_INACTIVITY_MS  = 5 * 60 * 1000;    // 5 min inactivity ends session
    var SR_INACT_CHECK_MS = 10000;
    var SR_MAX_EVENTS     = 20000;
    var DC_DELAY_MS       = 1000;

    // ── Utilities ────────────────────────────────────────────────────────────
    function now() { return Date.now(); }

    function safeJson(raw, def) {
      try { return raw ? JSON.parse(raw) : def; } catch (_) { return def; }
    }

    function makeId(prefix) {
      var id = (window.crypto && typeof window.crypto.randomUUID === "function")
        ? window.crypto.randomUUID()
        : now() + "_" + Math.random().toString(36).slice(2, 10);
      return prefix ? prefix + "_" + id : id;
    }

    function getOrCreate(storage, key, prefix) {
      try {
        var v = storage.getItem(key);
        if (v) return v;
        var n = makeId(prefix);
        storage.setItem(key, n);
        return n;
      } catch (_) { return makeId(prefix); }
    }

    function debounce(fn, wait) {
      var tid = null;
      return function () {
        var a = arguments;
        clearTimeout(tid);
        tid = setTimeout(function () { tid = null; try { fn.apply(null, a); } catch (_) {} }, wait);
      };
    }

    function deviceType() {
      var w = window.innerWidth || 0;
      return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
    }

    function docMetrics() {
      var r = document.documentElement, b = document.body || {};
      return {
        vw: window.innerWidth  || r.clientWidth  || 0,
        vh: window.innerHeight || r.clientHeight || 0,
        dw: Math.max(r.scrollWidth||0, r.offsetWidth||0, r.clientWidth||0,  b.scrollWidth||0, b.offsetWidth||0),
        dh: Math.max(r.scrollHeight||0, r.offsetHeight||0, r.clientHeight||0, b.scrollHeight||0, b.offsetHeight||0),
        sx: window.scrollX || r.scrollLeft || 0,
        sy: window.scrollY || r.scrollTop  || 0,
      };
    }

    function cssSelector(el) {
      if (!el || el.nodeType !== 1) return "unknown";
      if (el === document.body) return "body";
      var parts = [], cur = el;
      while (cur && cur !== document.body && cur.nodeType === 1 && parts.length < 4) {
        var p = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift(p + "#" + cur.id.replace(/[^\w-]/g, "_")); break; }
        var cls = [].slice.call(cur.classList || [], 0, 2).join(".");
        if (cls) p += "." + cls;
        parts.unshift(p);
        cur = cur.parentElement;
      }
      return parts.join(" > ") || (el.tagName ? el.tagName.toLowerCase() : "unknown");
    }

    // ── Transport ─────────────────────────────────────────────────────────────
    function post(path, payload, keepalive) {
      var body = JSON.stringify(payload);
      var url  = BASE_URL + path;
      try {
        if (keepalive && navigator.sendBeacon) {
          if (navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) return;
        }
      } catch (_) {}
      try {
        window.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: Boolean(keepalive),
          credentials: "omit",
        }).catch(function () {});
      } catch (_) {}
    }

    // ── Identity ──────────────────────────────────────────────────────────────
    var userId    = getOrCreate(window.localStorage,   USER_ID_KEY,    "u");
    var sessionId = getOrCreate(window.sessionStorage, SESSION_ID_KEY, "s");
    var userProps = safeJson(window.localStorage.getItem(USER_PROPS_KEY), {});

    function identify(id) {
      try {
        if (!id) return;
        userId = String(id);
        window.localStorage.setItem(USER_ID_KEY, userId);
      } catch (_) {}
    }

    function setUserProperties(props) {
      try {
        if (!props || typeof props !== "object") return;
        userProps = Object.assign({}, userProps, props);
        window.localStorage.setItem(USER_PROPS_KEY, JSON.stringify(userProps));
      } catch (_) {}
    }

    // ── Central history patch (patch ONCE, all handlers dispatch from here) ───
    var historyHandlers = [];

    function dispatchHistoryChange() {
      for (var i = 0; i < historyHandlers.length; i++) {
        try { historyHandlers[i](); } catch (_) {}
      }
    }

    function patchHistoryMethod(name) {
      try {
        var orig = history[name];
        if (typeof orig !== "function") return;
        history[name] = function () {
          var r = orig.apply(this, arguments);
          dispatchHistoryChange();
          return r;
        };
      } catch (_) {}
    }

    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    window.addEventListener("popstate",   dispatchHistoryChange);
    window.addEventListener("hashchange", dispatchHistoryChange);

    // ── Event Queue ───────────────────────────────────────────────────────────
    var evtQueue = [], evtTimer = null, lastClickKey = {}, rageHist = [];

    function flushEvt() {
      if (!evtQueue.length) return;
      var batch = evtQueue.splice(0, evtQueue.length);
      for (var i = 0; i < batch.length; i++) post("/track", batch[i], false);
    }

    function schedFlush() {
      if (evtTimer) return;
      evtTimer = setTimeout(function () { evtTimer = null; flushEvt(); }, EVT_FLUSH_MS);
    }

    function shouldDrop(name, props) {
      if (name !== "click") return false;
      var k = "click:" + ((props && props.tag) || "") + ":" + ((props && props.id) || "");
      var last = lastClickKey[k] || 0, t = now();
      if (t - last < CLICK_DEBOUNCE_MS) return true;
      lastClickKey[k] = t;
      return false;
    }

    function track(name, props) {
      try {
        var p = (props && typeof props === "object") ? props : {};
        if (shouldDrop(name, p)) return;
        evtQueue.push({
          project_id: PROJECT_ID,
          user_id: userId,
          session_id: sessionId,
          event_name: name,
          page: window.location.pathname,
          url: window.location.href,
          timestamp: now(),
          properties: Object.assign({}, userProps, p),
        });
        if (evtQueue.length >= EVT_BATCH_SIZE) { flushEvt(); return; }
        schedFlush();
      } catch (_) {}
    }

    // ── Page View ─────────────────────────────────────────────────────────────
    var debouncedPV = debounce(function () { track("page_view"); }, ROUTE_DEBOUNCE_MS);
    historyHandlers.push(debouncedPV);
    track("page_view");

    // ── Click & Rage Click ────────────────────────────────────────────────────
    function detectRage(e) {
      try {
        var t = now();
        var area = Math.floor((e.clientX || 0) / RAGE_AREA_PX) + ":" + Math.floor((e.clientY || 0) / RAGE_AREA_PX);
        rageHist.push({ t: t, area: area });
        rageHist = rageHist.filter(function (x) { return t - x.t <= RAGE_WINDOW_MS; });
        var cnt = rageHist.filter(function (x) { return x.area === area; }).length;
        if (cnt >= RAGE_CLICK_COUNT) { track("rage_click", { area: area, click_count: cnt }); rageHist = []; }
      } catch (_) {}
    }

    document.addEventListener("click", function (e) {
      try {
        var tgt = e.target || {};
        track("click", {
          tag:   tgt.tagName  || "",
          text:  String(tgt.innerText || tgt.textContent || "").slice(0, 50),
          id:    tgt.id       || "",
          class: String(tgt.className || "").slice(0, 100),
        });
        detectRage(e);
      } catch (_) {}
    }, { capture: true, passive: true });

    // ── Error Tracking ────────────────────────────────────────────────────────
    window.addEventListener("error", function (e) {
      try { track("error", { message: e.message, source: e.filename, line: e.lineno }); } catch (_) {}
    });

    window.addEventListener("unhandledrejection", function (e) {
      try {
        var r = e.reason;
        track("promise_error", { message: typeof r === "string" ? r : (r && r.message) || String(r) });
      } catch (_) {}
    });

    // ── Heatmap: Clicks ───────────────────────────────────────────────────────
    var hmClicks = [], hmClickTimer = null;

    function flushHmClicks(keepalive) {
      if (!hmClicks.length) return;
      var b = hmClicks.splice(0, hmClicks.length);
      post("/heatmap/click", { events: b }, keepalive);
    }

    document.addEventListener("click", function (e) {
      try {
        var m  = docMetrics();
        var px = Number.isFinite(e.pageX) ? e.pageX : e.clientX + m.sx;
        var py = Number.isFinite(e.pageY) ? e.pageY : e.clientY + m.sy;
        hmClicks.push({
          project_id:       PROJECT_ID,
          user_id:          userId,
          session_id:       sessionId,
          page_url:         window.location.pathname,
          x_coordinate:     e.clientX,
          y_coordinate:     e.clientY,
          page_x:           px,
          page_y:           py,
          x_percent:        m.vw > 0 ? e.clientX / m.vw : null,
          y_percent:        m.vh > 0 ? e.clientY / m.vh : null,
          page_x_percent:   m.dw > 0 ? px / m.dw : null,
          page_y_percent:   m.dh > 0 ? py / m.dh : null,
          viewport_width:   m.vw,
          viewport_height:  m.vh,
          document_width:   m.dw,
          document_height:  m.dh,
          scroll_x:         m.sx,
          scroll_y:         m.sy,
          device_type:      deviceType(),
          element_selector: cssSelector(e.target),
          element_text:     String((e.target && (e.target.innerText || e.target.textContent)) || "").trim().slice(0, 100),
          timestamp:        new Date().toISOString(),
        });
        if (hmClicks.length >= HM_CLICK_MAX) {
          clearTimeout(hmClickTimer);
          hmClickTimer = null;
          flushHmClicks(false);
          return;
        }
        if (!hmClickTimer) {
          hmClickTimer = setTimeout(function () { hmClickTimer = null; flushHmClicks(false); }, HM_CLICK_FLUSH_MS);
        }
      } catch (_) {}
    }, { capture: true, passive: true });

    // ── Heatmap: Hover ────────────────────────────────────────────────────────
    var hmHovers = [], hmHoverTimer = null, hmHoverLastAt = 0, hmHoverLastPt = null;

    function shouldSampleHover(e) {
      var t = now();
      if (t - hmHoverLastAt < HM_HOVER_SAMPLE) return false;
      if (hmHoverLastPt) {
        var dx = e.clientX - hmHoverLastPt.x, dy = e.clientY - hmHoverLastPt.y;
        if (Math.sqrt(dx * dx + dy * dy) < HM_HOVER_MIN_DIST) return false;
      }
      hmHoverLastAt = t;
      hmHoverLastPt = { x: e.clientX, y: e.clientY };
      return true;
    }

    function flushHmHovers(keepalive) {
      if (!hmHovers.length) return;
      var b = hmHovers.splice(0, hmHovers.length);
      post("/heatmap/hover", { events: b }, keepalive);
    }

    document.addEventListener("mousemove", function (e) {
      try {
        if (!shouldSampleHover(e)) return;
        var m  = docMetrics();
        var px = Number.isFinite(e.pageX) ? e.pageX : e.clientX + m.sx;
        var py = Number.isFinite(e.pageY) ? e.pageY : e.clientY + m.sy;
        hmHovers.push({
          project_id:      PROJECT_ID,
          user_id:         userId,
          session_id:      sessionId,
          page_url:        window.location.pathname,
          x_coordinate:    e.clientX,
          y_coordinate:    e.clientY,
          page_x:          px,
          page_y:          py,
          x_percent:       m.vw > 0 ? e.clientX / m.vw : null,
          y_percent:       m.vh > 0 ? e.clientY / m.vh : null,
          page_x_percent:  m.dw > 0 ? px / m.dw : null,
          page_y_percent:  m.dh > 0 ? py / m.dh : null,
          viewport_width:  m.vw,
          viewport_height: m.vh,
          document_width:  m.dw,
          document_height: m.dh,
          scroll_x:        m.sx,
          scroll_y:        m.sy,
          device_type:     deviceType(),
          timestamp:       new Date().toISOString(),
        });
        if (hmHovers.length >= HM_HOVER_MAX) {
          clearTimeout(hmHoverTimer);
          hmHoverTimer = null;
          flushHmHovers(false);
          return;
        }
        if (!hmHoverTimer) {
          hmHoverTimer = setTimeout(function () { hmHoverTimer = null; flushHmHovers(false); }, HM_HOVER_FLUSH_MS);
        }
      } catch (_) {}
    }, { capture: true, passive: true });

    // ── Heatmap: Scroll ───────────────────────────────────────────────────────
    var hmScrollMax = 0, hmScrollLast = 0, hmScrollLastAt = 0, hmScrollTimer = null;

    function calcScrollDepth() {
      try {
        var sh = Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0);
        var vh = window.innerHeight || 0;
        var sy = window.scrollY    || document.documentElement.scrollTop || 0;
        if (sh <= vh) return 100;
        return Math.min(Math.round(((sy + vh) / sh) * 100), 100);
      } catch (_) { return 0; }
    }

    function sendScroll(keepalive) {
      var m = docMetrics();
      post("/heatmap/scroll", {
        project_id:              PROJECT_ID,
        user_id:                 userId,
        session_id:              sessionId,
        page_url:                window.location.pathname,
        scroll_depth_percentage: hmScrollMax,
        viewport_height:         m.vh,
        document_height:         m.dh,
        timestamp:               new Date().toISOString(),
      }, keepalive);
    }

    function onScrollThrottled() {
      try {
        var d = calcScrollDepth();
        if (d > hmScrollMax) hmScrollMax = d;
        var t = now(), delta = Math.abs(d - hmScrollLast);
        if (t - hmScrollLastAt >= HM_SCROLL_THROTTLE || (delta >= HM_SCROLL_THRESH && d === 100)) {
          hmScrollLastAt = t;
          hmScrollLast   = d;
          sendScroll(false);
        }
      } catch (_) {}
    }

    window.addEventListener("scroll", function () {
      clearTimeout(hmScrollTimer);
      hmScrollTimer = setTimeout(onScrollThrottled, 100);
    }, { passive: true });

    // ── Page Snapshot ─────────────────────────────────────────────────────────
    var snapTimer = null, snapLastAt = 0, snapLastFp = "", snapBusy = false;

    function absUrl(v) {
      if (!v || typeof v !== "string") return v;
      var t = v.trim();
      if (!t || /^(data:|blob:|#)/.test(t)) return t;
      try { return new URL(t, window.location.href).toString(); } catch (_) { return t; }
    }

    function sanitizeHtml() {
      var clone = document.documentElement.cloneNode(true);

      // Sync live form state into clone
      var srcFields = document.documentElement.querySelectorAll("input,textarea,select");
      var clnFields = clone.querySelectorAll("input,textarea,select");
      for (var i = 0; i < srcFields.length; i++) {
        var sf = srcFields[i], cf = clnFields[i];
        if (!cf) continue;
        if (sf.tagName === "INPUT") {
          if (sf.type === "checkbox" || sf.type === "radio") {
            if (sf.checked) cf.setAttribute("checked", "checked"); else cf.removeAttribute("checked");
          } else {
            cf.setAttribute("value", sf.value);
          }
        } else if (sf.tagName === "TEXTAREA") {
          cf.textContent = sf.value;
        } else if (sf.tagName === "SELECT") {
          var opts = cf.options;
          for (var j = 0; j < opts.length; j++) opts[j].selected = sf.options[j] ? sf.options[j].selected : false;
        }
      }

      // Remove executable nodes
      var unsafe = clone.querySelectorAll("script,noscript,iframe,object,embed");
      for (var k = 0; k < unsafe.length; k++) {
        if (unsafe[k].parentNode) unsafe[k].parentNode.removeChild(unsafe[k]);
      }

      // Absolutize all resource URLs
      var urlEls = clone.querySelectorAll("[src],[href],[poster],[action],[srcset]");
      for (var l = 0; l < urlEls.length; l++) {
        var el = urlEls[l];
        if (el.hasAttribute("src"))    el.setAttribute("src",    absUrl(el.getAttribute("src")));
        if (el.hasAttribute("href"))   el.setAttribute("href",   absUrl(el.getAttribute("href")));
        if (el.hasAttribute("poster")) el.setAttribute("poster", absUrl(el.getAttribute("poster")));
        if (el.hasAttribute("action")) el.setAttribute("action", absUrl(el.getAttribute("action")));
        if (el.hasAttribute("srcset")) {
          var ss = el.getAttribute("srcset").split(",").map(function (entry) {
            var parts = entry.trim().split(/\s+/);
            return parts[1] ? absUrl(parts[0]) + " " + parts[1] : absUrl(parts[0]);
          }).join(", ");
          el.setAttribute("srcset", ss);
        }
      }

      // Strip inline event handlers and javascript: URLs
      var all = clone.querySelectorAll("*");
      for (var m2 = 0; m2 < all.length; m2++) {
        var attrs = [].slice.call(all[m2].attributes);
        for (var n = 0; n < attrs.length; n++) {
          var an = attrs[n].name.toLowerCase(), av = attrs[n].value || "";
          if (an.indexOf("on") === 0) { all[m2].removeAttribute(attrs[n].name); continue; }
          if ((an === "href" || an === "src" || an === "action") && /^javascript:/i.test(av.trim())) {
            all[m2].removeAttribute(attrs[n].name);
          }
        }
      }

      // Ensure relative resources resolve correctly in replay
      var head = clone.querySelector("head");
      if (head && !head.querySelector("base")) {
        var base = document.createElement("base");
        base.setAttribute("href", window.location.origin + "/");
        head.insertBefore(base, head.firstChild);
      }

      return "<!DOCTYPE html>" + clone.outerHTML;
    }

    function doSnapshot(reason) {
      if (document.hidden || snapBusy) return;
      var t = now();
      if (t - snapLastAt < SNAP_MIN_MS && reason !== "route_change") return;
      snapBusy = true;
      try {
        var m    = docMetrics();
        var html = sanitizeHtml();
        var fp   = [window.location.pathname, deviceType(), m.dw, m.dh, html.length].join(":");
        if (fp === snapLastFp && reason !== "route_change") { snapBusy = false; return; }
        post("/heatmap/snapshot", {
          project_id:      PROJECT_ID,
          user_id:         userId,
          session_id:      sessionId,
          page_url:        window.location.pathname,
          dom_snapshot:    html,
          viewport_width:  m.vw,
          viewport_height: m.vh,
          document_width:  m.dw,
          document_height: m.dh,
          scroll_x:        m.sx,
          scroll_y:        m.sy,
          device_type:     deviceType(),
          reason:          reason || "manual",
          timestamp:       new Date().toISOString(),
        }, false);
        snapLastAt = t;
        snapLastFp = fp;
      } catch (_) {}
      snapBusy = false;
    }

    function schedSnap(reason) {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(function () { doSnapshot(reason); }, SNAP_DEBOUNCE_MS);
    }

    window.addEventListener("load",   function () { schedSnap("load"); },   { once: true });
    window.addEventListener("resize", function () { schedSnap("resize"); }, { passive: true });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) schedSnap("visible"); });
    historyHandlers.push(function () { schedSnap("route_change"); });
    schedSnap("init");

    // ── Session Recording ─────────────────────────────────────────────────────
    // Create a fresh session ID for this recording session
    var srSid = (function () {
      var id = makeId("s");
      try { window.sessionStorage.setItem(SESSION_ID_KEY, id); } catch (_) {}
      sessionId = id; // keep global sessionId in sync
      return id;
    })();

    var srUid      = userId;
    var srStartIso = new Date().toISOString();
    var srBuf      = [], srTotal = 0, srEnding = false, srFlushing = false;
    var srFlushTmr = null, srDurTmr = null, srInactTmr = null;
    var srStop     = null, srLastAct = now();

    function srFlush(keepalive, isFinal, reason) {
      if (srFlushing) return;
      if (!srBuf.length && !isFinal) return;
      srFlushing = true;
      var nowIso = new Date().toISOString();
      var events = srBuf.splice(0, srBuf.length);
      post("/session-record", {
        project_id:       PROJECT_ID,
        user_id:          srUid,
        session_id:       srSid,
        events:           events,
        timestamp:        nowIso,
        start_timestamp:  srStartIso,
        end_timestamp:    isFinal ? nowIso : null,
        session_finished: Boolean(isFinal),
        end_reason:       reason || null,
      }, Boolean(keepalive));
      srFlushing = false;
    }

    function srEnd(reason, keepalive) {
      if (srEnding) return;
      srEnding = true;
      clearInterval(srFlushTmr);
      clearTimeout(srDurTmr);
      clearInterval(srInactTmr);
      if (srStop) { try { srStop(); } catch (_) {} srStop = null; }
      srFlush(keepalive, true, reason);
    }

    // Load rrweb from the same server that serves this script
    var rrwebScript = document.createElement("script");
    rrwebScript.src   = BASE_URL + "/rrweb.js";
    rrwebScript.async = true;
    rrwebScript.onload = function () {
      try {
        var rr = window.rrweb || {};
        var record = rr.record || (rr.default && rr.default.record);
        if (typeof record !== "function") return;

        srStop = record({
          emit: function (event) {
            if (srEnding) return;
            srBuf.push(event);
            srTotal++;
            if (srTotal > SR_MAX_EVENTS) { srEnd("event_limit_reached", false); return; }
            // Flush immediately after full snapshot events (type 2)
            if (event && Number(event.type) === 2) srFlush(false, false, null);
          },
          checkoutEveryNms: 15000,
          sampling: { mousemove: 50 },
        });
      } catch (_) {}
    };
    rrwebScript.onerror = function () {}; // gracefully degrade if rrweb not available
    document.head.appendChild(rrwebScript);

    srFlushTmr  = setInterval(function () { srFlush(false, false, null); }, SR_FLUSH_MS);
    srDurTmr    = setTimeout(function ()  { srEnd("max_duration_reached", false); }, SR_MAX_DURATION);
    srInactTmr  = setInterval(function () {
      if (now() - srLastAct >= SR_INACTIVITY_MS) srEnd("inactivity_timeout", false);
    }, SR_INACT_CHECK_MS);

    var actEvts = ["mousemove", "click", "scroll", "keydown"];
    for (var ai = 0; ai < actEvts.length; ai++) {
      window.addEventListener(actEvts[ai], function () { srLastAct = now(); }, { passive: true });
    }

    // Report frontend errors through the dedicated endpoint
    function sendFrontendError(msg, stack) {
      post("/frontend-error", {
        project_id: PROJECT_ID,
        user_id:    srUid,
        session_id: srSid,
        message:    String(msg || "Unknown error"),
        stack:      stack || null,
        page:       window.location.pathname,
        timestamp:  new Date().toISOString(),
      }, false);
    }

    window.addEventListener("error", function (e) {
      try { sendFrontendError(e.message, e.error && e.error.stack); } catch (_) {}
    });
    window.addEventListener("unhandledrejection", function (e) {
      try {
        var r = e.reason;
        sendFrontendError(r && r.message || String(r || "Unhandled rejection"), r && r.stack);
      } catch (_) {}
    });

    // ── Dead Click Detection ──────────────────────────────────────────────────
    var dcMut = 0, dcNav = 0;
    var dcObs = new MutationObserver(function () { dcMut++; });
    dcObs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

    // Register nav counter via central history patch (no double-patching)
    historyHandlers.push(function () { dcNav++; });

    document.addEventListener("click", function (e) {
      try {
        var x   = Math.round(e.clientX), y = Math.round(e.clientY);
        var el  = cssSelector(e.target);
        var pg  = window.location.pathname;
        var ts2 = new Date().toISOString();
        var snapM = dcMut, snapN = dcNav;
        setTimeout(function () {
          if (dcMut === snapM && dcNav === snapN) {
            post("/dead-click", {
              session_id: srSid,
              user_id:    srUid,
              page:       pg,
              element:    el,
              timestamp:  ts2,
              x:          x,
              y:          y,
            }, false);
          }
        }, DC_DELAY_MS);
      } catch (_) {}
    }, { capture: true, passive: true });

    // ── Flush Everything on Page Exit ─────────────────────────────────────────
    window.addEventListener("beforeunload", function () {
      flushEvt();
      flushHmClicks(true);
      flushHmHovers(true);
      if (hmScrollMax > 0) sendScroll(true);
      srEnd("page_exit", true);
    });

    // ── Public API ────────────────────────────────────────────────────────────
    window.analytics = {
      track:             track,
      identify:          identify,
      setUserProperties: setUserProperties,
    };

  } catch (_fatalErr) {
    // Swallow all top-level failures — never break the host site.
  }
})();
