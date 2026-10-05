const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "static", "js", "language-routing.js"),
  "utf8"
);

function runCase(options) {
  const storage = new Map();
  if (options.country) {
    storage.set("bobo-region-detection-v1", JSON.stringify({
      country: options.country,
      expiresAt: Date.now() + 60000
    }));
  }
  if (options.preference) {
    storage.set("bobo-language-preference", options.preference);
  }

  let redirected = null;
  const routeElements = Object.keys(options.routes).map(function (language) {
    return {
      getAttribute: function (name) {
        return name === "data-language" ? language : options.routes[language];
      }
    };
  });

  const context = {
    window: {
      localStorage: {
        getItem: function (key) { return storage.get(key) || null; },
        setItem: function (key, value) { storage.set(key, value); }
      },
      location: {
        pathname: options.pathname,
        replace: function (value) { redirected = value; }
      },
      navigator: { languages: ["en-US"], language: "en-US" },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      fetch: function () { return Promise.reject(new Error("Unexpected fetch")); }
    },
    document: {
      cookie: "",
      querySelectorAll: function (selector) {
        return selector === 'meta[name="site-language-route"]' ? routeElements : [];
      }
    },
    Intl: Intl,
    AbortController: AbortController,
    Date: Date,
    JSON: JSON,
    String: String,
    Array: Array,
    Promise: Promise,
    Error: Error
  };

  vm.runInNewContext(source, context);
  assert.strictEqual(redirected, options.expected, options.name);
}

const landingRoutes = { "zh-cn": "/about/", en: "/en/about/" };

runCase({
  name: "China root opens Chinese About",
  pathname: "/",
  routes: landingRoutes,
  country: "CN",
  expected: "/about/"
});
runCase({
  name: "Outside China root opens English About",
  pathname: "/",
  routes: landingRoutes,
  country: "NL",
  expected: "/en/about/"
});
runCase({
  name: "Manual English preference overrides region",
  pathname: "/",
  routes: landingRoutes,
  country: "CN",
  preference: "en",
  expected: "/en/about/"
});
runCase({
  name: "Manual Chinese preference overrides region",
  pathname: "/en/",
  routes: landingRoutes,
  country: "NL",
  preference: "zh-cn",
  expected: "/about/"
});
runCase({
  name: "About page does not redirect to itself",
  pathname: "/about/",
  routes: landingRoutes,
  country: "CN",
  expected: null
});
runCase({
  name: "Translated post still follows region",
  pathname: "/post/example/",
  routes: { "zh-cn": "/post/example/", en: "/en/post/example/" },
  country: "NL",
  expected: "/en/post/example/"
});

console.log("language-routing: 6 cases passed");
