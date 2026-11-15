"use strict";

const assert = require("node:assert/strict");
const vm = require("node:vm");
const { SHARE_PREFIX, shareHookSource, parseSharePayload } = require("../share-hook");

function install(binding) {
  const messages = [];
  const tracks = [];
  function makeTrack() {
    const listeners = {};
    const track = {
      addEventListener(name, fn) {
        listeners[name] = fn;
      },
      stop() {
        if (listeners.ended) listeners.ended();
      },
    };
    tracks.push(track);
    return track;
  }
  const calls = [];
  const sandbox = {
    JSON,
    Promise,
    console: {
      info(message) {
        messages.push(message);
      },
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia(constraints) {
          calls.push(constraints);
          const list = [makeTrack(), makeTrack()];
          return Promise.resolve({
            getTracks() {
              return list;
            },
          });
        },
      },
    },
  };
  sandbox.window = sandbox;
  if (binding) sandbox.qonoDesktopShare = binding;
  vm.runInNewContext(shareHookSource(), sandbox);
  return { sandbox, messages, tracks, calls };
}

(async () => {
  const seen = [];
  const viaBinding = install((payload) => seen.push(payload));
  assert.equal(viaBinding.sandbox.__qonoShareHooked, true);
  const stream = await viaBinding.sandbox.navigator.mediaDevices.getDisplayMedia({ video: true });
  assert.deepEqual(viaBinding.calls[0], { video: true });
  assert.equal(seen.length, 1);
  const started = parseSharePayload(seen[0]);
  assert.equal(started.tracks, 2);
  assert.equal(started.active, true);
  assert.equal(typeof started.frame, "string");
  stream.getTracks()[0].stop();
  assert.equal(parseSharePayload(seen[1]).tracks, 1);
  assert.equal(parseSharePayload(seen[1]).frame, started.frame);
  stream.getTracks()[0].stop();
  assert.equal(parseSharePayload(seen[1]).tracks, 1);
  stream.getTracks()[1].stop();
  assert.deepEqual(parseSharePayload(seen[2]), { tracks: 0, active: false, frame: started.frame });
  assert.equal(viaBinding.messages.length, 0);

  const viaConsole = install(null);
  await viaConsole.sandbox.navigator.mediaDevices.getDisplayMedia({ video: true });
  assert.equal(viaConsole.messages[0].startsWith(SHARE_PREFIX), true);
  assert.equal(parseSharePayload(viaConsole.messages[0].slice(SHARE_PREFIX.length)).tracks, 2);
  viaConsole.tracks[0].stop();
  viaConsole.tracks[1].stop();
  assert.equal(parseSharePayload(viaConsole.messages.at(-1).slice(SHARE_PREFIX.length)).active, false);

  assert.equal(parseSharePayload("nope"), null);
  assert.equal(parseSharePayload(JSON.stringify({ tracks: "1" })), null);

  const rejected = install(() => {});
  rejected.sandbox.navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new Error("denied"));
  vm.runInNewContext("window.__qonoShareHooked = false", rejected.sandbox);
  vm.runInNewContext(shareHookSource(), rejected.sandbox);
  await assert.rejects(() => rejected.sandbox.navigator.mediaDevices.getDisplayMedia({}), /denied/);

  console.log("share hook tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
