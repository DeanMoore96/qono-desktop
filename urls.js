"use strict";

// Where the shell goes after consent. QONO_URL overrides this for local tests.
const QONO_HOME_URL = "https://qono.net";
const QONO_START_URL = "https://qono.net/connections?onboarding=1";

function startUrl() {
  return process.env.QONO_URL || QONO_START_URL;
}

function homeUrl() {
  return process.env.QONO_URL || QONO_HOME_URL;
}

function appOrigin() {
  return new URL(process.env.QONO_URL || QONO_HOME_URL).origin;
}

function appUrl(pathAndQuery) {
  return new URL(pathAndQuery, appOrigin() + "/").href;
}

module.exports = { QONO_HOME_URL, QONO_START_URL, startUrl, homeUrl, appOrigin, appUrl };
