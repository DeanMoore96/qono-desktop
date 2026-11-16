"use strict";

// Injected into the page's main world at document_start (before the page's
// own scripts). The preload cannot wrap getDisplayMedia: contextIsolation
// keeps that world separate from the page.
const SHARE_PREFIX = "QONO_DESKTOP_SHARE ";

function shareHookSource() {
  return `(() => {
    if (window.__qonoShareHooked) return;
    window.__qonoShareHooked = true;
    var tracks = 0;
    var frame = Math.random().toString(36).slice(2);
    var originalInfo = console.info.bind(console);
    function notify(count) {
      var payload = JSON.stringify({ active: count > 0, tracks: count, frame: frame });
      try {
        if (typeof window.qonoDesktopShare === "function") {
          window.qonoDesktopShare(payload);
          return;
        }
      } catch (err) {}
      originalInfo(${JSON.stringify(SHARE_PREFIX)} + payload);
    }
    function watch(stream) {
      var list = stream && typeof stream.getTracks === "function" ? stream.getTracks() : [];
      if (!list.length) return;
      list.forEach(function (track) {
        tracks += 1;
        var done = function () {
          if (track.__qonoEnded) return;
          track.__qonoEnded = true;
          tracks = Math.max(0, tracks - 1);
          notify(tracks);
        };
        track.addEventListener("ended", done);
        // Display-capture tracks can flip to ended without the event.
        if (typeof setInterval === "function") {
          var timer = setInterval(function () {
            if (track.readyState === "ended") {
              clearInterval(timer);
              done();
            }
          }, 400);
        }
      });
      notify(tracks);
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("pagehide", function () {
        if (!tracks) return;
        tracks = 0;
        notify(0);
      });
    }
    var md = navigator.mediaDevices;
    if (!md || typeof md.getDisplayMedia !== "function") return;
    var orig = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = function (constraints) {
      return Promise.resolve(orig(constraints)).then(function (stream) {
        try { watch(stream); } catch (err) {}
        return stream;
      });
    };
  })();`;
}

function parseSharePayload(payload) {
  try {
    const data = JSON.parse(payload);
    if (!data || typeof data.tracks !== "number" || !Number.isFinite(data.tracks)) return null;
    return {
      tracks: data.tracks,
      active: data.tracks > 0,
      frame: typeof data.frame === "string" && data.frame ? data.frame : "default",
    };
  } catch {
    return null;
  }
}

module.exports = { SHARE_PREFIX, shareHookSource, parseSharePayload };
