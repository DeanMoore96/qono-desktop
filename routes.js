"use strict";

// Proposed qono:// map. Pending Dean's confirmation. See docs/REQUIREMENTS-1.2.0.md.
function parseQonoLink(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return null;
  }
  if (url.protocol !== "qono:") return null;
  const segments = [];
  if (url.hostname) segments.push(url.hostname.toLowerCase());
  for (const part of url.pathname.split("/")) {
    if (part) segments.push(decodeURIComponent(part).toLowerCase());
  }
  const key = segments.join("/");
  if (key === "consent") return { kind: "consent" };
  if (key === "connect") return { kind: "page", path: "/connections" };
  if (key === "connect/chatgpt") return { kind: "page", path: "/connections?provider=openai" };
  if (key === "connect/claude") return { kind: "page", path: "/connections?provider=anthropic" };
  if (key === "voices") return { kind: "page", path: "/settings/voice" };
  return null;
}

function findQonoLink(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((arg) => typeof arg === "string" && arg.startsWith("qono:")) || null;
}

function classifyLink(url) {
  if (typeof url === "string" && url.startsWith("qono:")) return "in-app";
  return "external";
}

module.exports = { parseQonoLink, findQonoLink, classifyLink };
