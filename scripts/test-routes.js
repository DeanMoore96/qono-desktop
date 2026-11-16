"use strict";

const assert = require("node:assert/strict");
const { parseQonoLink, findQonoLink, classifyLink } = require("../routes");
const { QONO_START_URL, appUrl } = require("../urls");

assert.equal(QONO_START_URL, "https://qono.net/connections?onboarding=1");
assert.deepEqual(parseQonoLink("qono://consent"), { kind: "consent" });
assert.deepEqual(parseQonoLink("qono://connect"), { kind: "page", path: "/connections" });
assert.deepEqual(parseQonoLink("qono://connect/chatgpt"), { kind: "page", path: "/connections?provider=openai" });
assert.deepEqual(parseQonoLink("qono://connect/claude"), { kind: "page", path: "/connections?provider=anthropic" });
assert.deepEqual(parseQonoLink("qono://voices"), { kind: "page", path: "/voices" });
assert.equal(parseQonoLink("qono://nope"), null);
assert.equal(parseQonoLink("https://qono.net/connections"), null);
assert.equal(findQonoLink(["Qono.exe", "--hidden", "qono://voices"]), "qono://voices");
assert.equal(classifyLink("qono://consent"), "in-app");
assert.equal(classifyLink("https://example.com"), "external");

process.env.QONO_URL = "http://127.0.0.1:9/app";
assert.equal(appUrl("/connections?provider=openai"), "http://127.0.0.1:9/connections?provider=openai");
delete process.env.QONO_URL;
assert.equal(appUrl("/voices"), "https://qono.net/voices");

console.log("route tests passed");
