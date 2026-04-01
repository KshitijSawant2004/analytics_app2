(function () {
  "use strict";

  try {
    var USER_ID_KEY = "analytics_user_id";
    var SESSION_ID_KEY = "analytics_session_id";
    var RRWEB_CDN_URLS = [
      "https://cdn.jsdelivr.net/npm/rrweb@1/dist/record/rrweb-record.min.js",
      "https://unpkg.com/rrweb@1/dist/record/rrweb-record.min.js",
    ];
    var BATCH_SIZE = 10;
    var FLUSH_INTERVAL_MS = 2000;
    var SESSION_FLUSH_INTERVAL_MS = 5000;
    var SESSION_MAX_DURATION_MS = 10 * 60 * 1000;
    var CLICK_DEBOUNCE_MS = 150;
    var ROUTE_DEBOUNCE_MS = 250;
    var RAGE_WINDOW_MS = 1000;
    var RAGE_CLICK_COUNT = 3;
    var RAGE_AREA_PX = 48;

    var scriptEl =
      document.currentScript ||
      document.querySelector("script[data-project-id][src*='analytics.js']") ||
      document.querySelector("script[data-project-id]");

    var scriptSrc = (scriptEl && scriptEl.getAttribute("src")) || "";

    function sanitizeProjectId(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    }

    function inferProjectId() {
      try {
        var host = String(window.location.hostname || "").trim();
        var cleaned = sanitizeProjectId(host);
        if (cleaned) return cleaned;
      } catch (_err) {
        // Fall through to default.
      }
      return "default-project";
    }

    var projectId = sanitizeProjectId(scriptEl && scriptEl.getAttribute("data-project-id")) || inferProjectId();
    var endpointAttr = scriptEl && scriptEl.getAttribute("data-endpoint");

    // Guard against duplicate script injection on SPAs/templated pages.
    if (typeof window !== "undefined") {
      window.__analyticsTrackerInitByProject = window.__analyticsTrackerInitByProject || {};
      if (window.__analyticsTrackerInitByProject[projectId]) {
        return;
      }
      window.__analyticsTrackerInitByProject[projectId] = true;
    }

    function trimTrailingSlash(value) {
      return String(value || "").replace(/\/+$/, "");
    }

    function inferDefaultEndpoint() {
      try {
        if (scriptSrc) {
          var srcUrl = new URL(scriptSrc, window.location.href);
          return trimTrailingSlash(srcUrl.origin) + "/track";
        }
      } catch (_err) {
        // Fall through to page origin fallback.
      }

      try {
        return trimTrailingSlash(window.location.origin) + "/track";
      } catch (_err2) {
        return "/track";
      }
    }

    function deriveEndpoints(rawEndpoint) {
      var base = "https://analyticsapp2-production.up.railway.app";
      return {
        trackEndpoint: base + "/api/track",
        sessionRecordEndpoint: base + "/api/session-record",
        frontendErrorEndpoint: base + "/api/frontend-error",
      };
    }

    function postJsonWithFallback(candidates, body, useBeaconFirst) {
      if (!candidates || candidates.length === 0) return;

      if (useBeaconFirst && navigator.sendBeacon) {
        for (var i = 0; i < candidates.length; i += 1) {
          try {
            var blob = new Blob([body], { type: "application/json" });
            var beaconOk = navigator.sendBeacon(candidates[i], blob);
            if (beaconOk) return;
          } catch (_beaconErr) {
            // Fall through to fetch retry.
          }
        }
      }

      function tryFetchAt(index) {
        if (index >= candidates.length) return;

        try {
          window.fetch(candidates[index], {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: body,
            keepalive: true,
            credentials: "omit",
          })
            .then(function (response) {
              if (response && response.ok) return;
              tryFetchAt(index + 1);
            })
            .catch(function () {
              tryFetchAt(index + 1);
            });
        } catch (_err) {
          tryFetchAt(index + 1);
        }
      }

      tryFetchAt(0);
    }

    var endpoint = endpointAttr || inferDefaultEndpoint();
    var endpoints = deriveEndpoints(endpoint);
    var trackEndpoint = endpoints.trackEndpoint;
    var sessionRecordEndpoint = endpoints.sessionRecordEndpoint;
    var frontendErrorEndpoint = endpoints.frontendErrorEndpoint;
    var trackEndpointCandidates = buildLocalFallbackCandidates(trackEndpoint);
    var sessionRecordEndpointCandidates = buildLocalFallbackCandidates(sessionRecordEndpoint);
    var frontendErrorEndpointCandidates = buildLocalFallbackCandidates(frontendErrorEndpoint);

    function now() {
      return Date.now();
    }

    function safeJsonParse(raw, fallback) {
      try {
        if (!raw) return fallback;
        var parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
      } catch (_err) {
        return fallback;
      }
    }

    function randomId(prefix) {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return prefix ? prefix + "_" + window.crypto.randomUUID() : window.crypto.randomUUID();
      }
      var suffix = Math.random().toString(36).slice(2, 10);
      return (prefix ? prefix + "_" : "") + now() + "_" + suffix;
    }

    function getOrCreateStorageValue(storage, key, prefix) {
      try {
        var existing = storage.getItem(key);
        if (existing) return existing;
        var next = randomId(prefix);
        storage.setItem(key, next);
        return next;
      } catch (_err) {
        return randomId(prefix);
      }
    }

    var userId = getOrCreateStorageValue(window.localStorage, USER_ID_KEY, "u");
    var sessionId = getOrCreateStorageValue(window.sessionStorage, SESSION_ID_KEY, "s");
    var userProperties = safeJsonParse(window.localStorage.getItem("analytics_user_properties"), {});
    var queue = [];
    var sessionRecordingQueue = [];
    var flushTimer = null;
    var sessionFlushTimer = null;
    var stopSessionRecording = null;
    var sessionRecordHeartbeatSent = false;
    var sessionRecorderState = "initializing";
    var sessionStartMs = now();
    var sessionStartTimestamp = new Date(sessionStartMs).toISOString();
    var rrwebLoadState = {
      loading: false,
      callbacks: [],
    };
    var lastEventByKey = new Map();
    var clickHistory = [];
    var maxScrollDepthBucket = 0;

    function safeGetPathname() {
      try {
        return window.location.pathname;
      } catch (_err) {
        return "";
      }
    }

    function safeGetHref() {
      try {
        return window.location.href;
      } catch (_err) {
        return "";
      }
    }

    function safeGetHost() {
      try {
        return window.location.host || "";
      } catch (_err) {
        return "";
      }
    }

    function safeGetOrigin() {
      try {
        return window.location.origin || "";
      } catch (_err) {
        return "";
      }
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = window.setTimeout(function () {
        flushTimer = null;
        flushQueue();
      }, FLUSH_INTERVAL_MS);
    }

    function shouldDropFrequentEvent(eventName, properties) {
      if (eventName !== "click") return false;
      var key = "click:" + String((properties && properties.tag) || "") + ":" + String((properties && properties.id) || "");
      var lastAt = lastEventByKey.get(key) || 0;
      var ts = now();
      if (ts - lastAt < CLICK_DEBOUNCE_MS) {
        return true;
      }
      lastEventByKey.set(key, ts);
      return false;
    }

    function sendEvent(eventPayload) {
      if (!eventPayload) return;

      var body = JSON.stringify(eventPayload);
      postJsonWithFallback(trackEndpointCandidates, body, true);
    }

    function sendFrontendError(payload) {
      if (!payload || !payload.message) return;

      try {
        var body = JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          message: String(payload.message || "Unknown frontend error"),
          stack: payload.stack ? String(payload.stack) : null,
          page: safeGetPathname(),
          timestamp: new Date(now()).toISOString(),
        });

        postJsonWithFallback(frontendErrorEndpointCandidates, body, false);
      } catch (_err) {
        // Ignore frontend error transport failures.
      }
    }

    function sendBatch(events) {
      if (!events || events.length === 0) return;
      for (var i = 0; i < events.length; i += 1) {
        sendEvent(events[i]);
      }
    }

    function flushQueue() {
      try {
        if (queue.length === 0) return;
        var toSend = queue.splice(0, queue.length);
        sendBatch(toSend);
      } catch (_err) {
        // Never throw from analytics internals.
      }
    }

    function flushSessionRecording(finalize, endReason) {
      try {
        var hasEvents = sessionRecordingQueue.length > 0;
        if (!hasEvents && !finalize && sessionRecordHeartbeatSent) return;

        var events = sessionRecordingQueue.splice(0, sessionRecordingQueue.length);
        var endTimestamp = new Date(now()).toISOString();
        if (!hasEvents && !finalize) {
          sessionRecordHeartbeatSent = true;
        }
        var payload = {
          user_id: userId,
          session_id: sessionId,
          events: events,
          timestamp: endTimestamp,
          start_timestamp: sessionStartTimestamp,
          end_timestamp: endTimestamp,
          session_finished: Boolean(finalize),
          end_reason: finalize ? (endReason || "unknown") : null,
          recorder_state: sessionRecorderState,
        };

        var body = JSON.stringify(payload);

        postJsonWithFallback(sessionRecordEndpointCandidates, body, Boolean(finalize));
      } catch (_err) {
        // Ignore session recording flush errors.
      }
    }

    function hasSessionExpired() {
      return now() - sessionStartMs >= SESSION_MAX_DURATION_MS;
    }

    function resetSessionMetadata(nextSessionId) {
      sessionId = String(nextSessionId || randomId("s"));
      try {
        window.sessionStorage.setItem(SESSION_ID_KEY, sessionId);
      } catch (_storageErr) {
        // Ignore session storage failures.
      }

      sessionStartMs = now();
      sessionStartTimestamp = new Date(sessionStartMs).toISOString();
      sessionRecordHeartbeatSent = false;
      sessionRecordingQueue = [];
    }

    function stopSessionRecordingNow() {
      if (sessionFlushTimer) {
        window.clearInterval(sessionFlushTimer);
        sessionFlushTimer = null;
      }

      if (typeof stopSessionRecording === "function") {
        try {
          stopSessionRecording();
        } catch (_err) {
          // Ignore rrweb stop errors.
        }
      }

      stopSessionRecording = null;
    }

    function rolloverSession(reason) {
      try {
        flushQueue();
        flushSessionRecording(true, reason || "max_duration_reached");
      } catch (_flushErr) {
        // Ignore flush errors while rolling over session.
      }

      stopSessionRecordingNow();
      resetSessionMetadata(randomId("s"));
      startSessionRecording();
    }

    function withRrwebRecorder(callback) {
      try {
        var recordFn = window.rrwebRecord || window.__analyticsRrwebRecord;
        if (typeof recordFn === "function") {
          sessionRecorderState = "recording";
          callback(recordFn);
          return;
        }

        rrwebLoadState.callbacks.push(callback);
        if (rrwebLoadState.loading) return;

        rrwebLoadState.loading = true;

        var urls = RRWEB_CDN_URLS.slice();
        if (scriptSrc) {
          try {
            var sourceUrl = new URL(scriptSrc, window.location.href);
            var hostedCopy = sourceUrl.origin + sourceUrl.pathname.replace(/analytics\.js$/i, "rrweb-record.min.js");
            urls.unshift(hostedCopy);
          } catch (_urlErr) {
            // Ignore malformed script src.
          }
        }

        var uniqueUrls = [];
        for (var u = 0; u < urls.length; u += 1) {
          if (uniqueUrls.indexOf(urls[u]) === -1) {
            uniqueUrls.push(urls[u]);
          }
        }

        function completeRecorderLoad() {
          rrwebLoadState.loading = false;
          var loadedRecordFn = window.rrwebRecord || window.__analyticsRrwebRecord;
          if (typeof loadedRecordFn !== "function") {
            sessionRecorderState = "unavailable";
            rrwebLoadState.callbacks = [];
            flushSessionRecording(false, "rrweb_unavailable");
            return;
          }

          sessionRecorderState = "recording";

          var callbacks = rrwebLoadState.callbacks.splice(0, rrwebLoadState.callbacks.length);
          for (var i = 0; i < callbacks.length; i += 1) {
            try {
              callbacks[i](loadedRecordFn);
            } catch (_callbackErr) {
              // Ignore callback errors.
            }
          }
        }

        function loadUrlAt(index) {
          if (index >= uniqueUrls.length) {
            sessionRecorderState = "unavailable";
            rrwebLoadState.loading = false;
            rrwebLoadState.callbacks = [];
            flushSessionRecording(false, "rrweb_unavailable");
            return;
          }

          var script = document.createElement("script");
          script.src = uniqueUrls[index];
          script.async = true;
          script.crossOrigin = "anonymous";
          script.onload = completeRecorderLoad;
          script.onerror = function () {
            loadUrlAt(index + 1);
          };
          document.head.appendChild(script);
        }

        loadUrlAt(0);
      } catch (_err) {
        sessionRecorderState = "unavailable";
        flushSessionRecording(false, "rrweb_loader_exception");
        // Ignore rrweb loader errors.
      }
    }

    function startSessionRecording() {
      if (sessionFlushTimer) return;

      sessionFlushTimer = window.setInterval(function () {
        if (hasSessionExpired()) {
          rolloverSession("max_duration_reached");
          return;
        }
        flushSessionRecording(false, "interval");
      }, SESSION_FLUSH_INTERVAL_MS);

      withRrwebRecorder(function (recordFn) {
        try {
          stopSessionRecording = recordFn({
            emit: function (event) {
              sessionRecordingQueue.push(event);
            },
            sampling: {
              mousemove: 50,
            },
          });
        } catch (_err) {
          // Ignore rrweb runtime errors.
        }
      });
    }

    function enqueue(payload) {
      queue.push(payload);
      if (queue.length >= BATCH_SIZE) {
        flushQueue();
        return;
      }
      scheduleFlush();
    }

    function track(eventName, properties) {
      try {
        if (hasSessionExpired()) {
          rolloverSession("max_duration_reached");
        }

        var nextProps = properties && typeof properties === "object" ? properties : {};

        if (shouldDropFrequentEvent(eventName, nextProps)) {
          return;
        }

        var payload = {
          project_id: projectId,
          user_id: userId,
          session_id: sessionId,
          event_name: eventName,
          page: safeGetPathname(),
          url: safeGetHref(),
          timestamp: now(),
          properties: Object.assign(
            {
              site_host: safeGetHost(),
              site_origin: safeGetOrigin(),
              page_title: document.title || "",
            },
            userProperties,
            nextProps
          ),
        };

        enqueue(payload);
      } catch (_err) {
        // Never throw from public API.
      }
    }

    function identify(nextUserId) {
      try {
        if (!nextUserId) return;
        userId = String(nextUserId);
        window.localStorage.setItem(USER_ID_KEY, userId);
      } catch (_err) {
        // Ignore storage failures.
      }
    }

    function setUserProperties(props) {
      try {
        if (!props || typeof props !== "object") return;
        userProperties = Object.assign({}, userProperties, props);
        window.localStorage.setItem("analytics_user_properties", JSON.stringify(userProperties));
      } catch (_err) {
        // Ignore persistence failures.
      }
    }

    function onRouteChange() {
      track("page_view");
    }

    function debounce(fn, wait) {
      var timeoutId = null;
      return function debounced() {
        var args = arguments;
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(function () {
          timeoutId = null;
          try {
            fn.apply(null, args);
          } catch (_err) {
            // Ignore callback errors.
          }
        }, wait);
      };
    }

    var debouncedRouteChange = debounce(onRouteChange, ROUTE_DEBOUNCE_MS);

    function patchHistoryMethod(name) {
      try {
        var original = history[name];
        if (typeof original !== "function") return;

        history[name] = function patchedHistoryMethod() {
          var result = original.apply(this, arguments);
          debouncedRouteChange();
          return result;
        };
      } catch (_err) {
        // Ignore monkey-patch failures.
      }
    }

    function bucketClickArea(x, y) {
      var bx = Math.floor((x || 0) / RAGE_AREA_PX);
      var by = Math.floor((y || 0) / RAGE_AREA_PX);
      return bx + ":" + by;
    }

    function detectRageClick(event) {
      try {
        var ts = now();
        var area = bucketClickArea(event && event.clientX, event && event.clientY);

        clickHistory.push({ t: ts, area: area });
        clickHistory = clickHistory.filter(function (entry) {
          return ts - entry.t <= RAGE_WINDOW_MS;
        });

        var sameAreaCount = 0;
        for (var i = clickHistory.length - 1; i >= 0; i -= 1) {
          if (clickHistory[i].area === area) {
            sameAreaCount += 1;
          }
        }

        if (sameAreaCount >= RAGE_CLICK_COUNT) {
          track("rage_click", {
            area: area,
            click_count: sameAreaCount,
          });
          clickHistory = [];
        }
      } catch (_err) {
        // Ignore rage detection errors.
      }
    }

    document.addEventListener(
      "click",
      function (e) {
        try {
          var target = (e && e.target) || {};
          track("click", {
            tag: target.tagName || "",
            text: String((target.innerText || target.textContent || "")).slice(0, 50),
            id: target.id || "",
            class: target.className || "",
          });
          detectRageClick(e);
        } catch (_err) {
          // Ignore click tracking errors.
        }
      },
      { capture: true, passive: true }
    );

    document.addEventListener(
      "submit",
      function (e) {
        try {
          var form = (e && e.target) || {};
          track("form_submit", {
            id: form.id || "",
            name: form.name || "",
            action: form.action || "",
            method: String(form.method || "get").toLowerCase(),
          });
        } catch (_err) {
          // Ignore form tracking errors.
        }
      },
      { capture: true, passive: true }
    );

    document.addEventListener(
      "change",
      function (e) {
        try {
          var target = (e && e.target) || {};
          var tag = String(target.tagName || "").toLowerCase();
          if (tag !== "input" && tag !== "select" && tag !== "textarea") return;
          track("field_change", {
            tag: target.tagName || "",
            type: target.type || "",
            id: target.id || "",
            name: target.name || "",
          });
        } catch (_err) {
          // Ignore change tracking errors.
        }
      },
      { capture: true, passive: true }
    );

    window.addEventListener(
      "scroll",
      function () {
        try {
          var doc = document.documentElement || {};
          var body = document.body || {};
          var scrollTop = Number(doc.scrollTop || body.scrollTop || 0);
          var viewport = Number(window.innerHeight || doc.clientHeight || 0);
          var scrollHeight = Number(doc.scrollHeight || body.scrollHeight || 0);
          var denominator = Math.max(1, scrollHeight - viewport);
          var percent = Math.max(0, Math.min(100, Math.round((scrollTop / denominator) * 100)));
          var bucket = Math.floor(percent / 25) * 25;
          if (bucket <= maxScrollDepthBucket) return;
          maxScrollDepthBucket = bucket;
          track("scroll_depth", { percent: percent, bucket: bucket });
        } catch (_err) {
          // Ignore scroll depth errors.
        }
      },
      { passive: true }
    );

    window.addEventListener("error", function (e) {
      try {
        sendFrontendError({
          message: e && e.message,
          stack: e && e.error && e.error.stack,
        });
        track("error", {
          message: e && e.message,
          source: e && e.filename,
          line: e && e.lineno,
        });
      } catch (_err) {
        // Ignore.
      }
    });

    window.addEventListener("unhandledrejection", function (e) {
      try {
        var reason = e && e.reason;
        sendFrontendError({
          message: (reason && reason.message) || (typeof reason === "string" ? reason : "Unhandled promise rejection"),
          stack: reason && reason.stack,
        });
        track("promise_error", {
          message: typeof reason === "string" ? reason : (reason && reason.message) || String(reason),
        });
      } catch (_err) {
        // Ignore.
      }
    });

    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    window.addEventListener("popstate", debouncedRouteChange);
    window.addEventListener("hashchange", debouncedRouteChange);

    window.addEventListener("beforeunload", function () {
      flushQueue();
      flushSessionRecording(true, "page_unload");
      if (typeof stopSessionRecording === "function") {
        try {
          stopSessionRecording();
        } catch (_err) {
          // Ignore teardown errors.
        }
      }
    });

    startSessionRecording();
    track("page_view");

    window.analytics = {
      track: track,
      identify: identify,
      setUserProperties: setUserProperties,
    };
  } catch (_fatalErr) {
    // Intentionally swallow all top-level failures.
  }
})();
