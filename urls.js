"use strict";

// Where the shell goes after consent and a current sign-in.
// QONO_URL overrides the origin for local tests.
const QONO_HOME_URL = "https://qono.net";
const QONO_START_URL = "https://qono.net/connections?onboarding=1";
const MANAGE_ACCOUNT_PATH = "/members";

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

function manageAccountUrl() {
  return appUrl(MANAGE_ACCOUNT_PATH);
}

module.exports = {
  QONO_HOME_URL,
  QONO_START_URL,
  MANAGE_ACCOUNT_PATH,
  startUrl,
  homeUrl,
  appOrigin,
  appUrl,
  manageAccountUrl,
};
