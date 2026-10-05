(function () {
  "use strict";

  var PREFERENCE_KEY = "bobo-language-preference";
  var REGION_KEY = "bobo-region-detection-v1";
  var REGION_TTL = 7 * 24 * 60 * 60 * 1000;
  var FAILURE_TTL = 30 * 60 * 1000;
  var LOOKUP_TIMEOUT = 2200;
  var COUNTRY_ENDPOINT = "https://api.country.is/";

  function normalizeLanguage(language) {
    var value = String(language || "").toLowerCase();
    return value.indexOf("zh") === 0 ? "zh-cn" : "en";
  }

  function readLocalStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeLocalStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Private browsing and strict privacy settings can disable storage.
    }
  }

  function readCookie(name) {
    var prefix = name + "=";
    var cookies = document.cookie ? document.cookie.split(";") : [];
    for (var index = 0; index < cookies.length; index += 1) {
      var cookie = cookies[index].trim();
      if (cookie.indexOf(prefix) === 0) {
        return decodeURIComponent(cookie.slice(prefix.length));
      }
    }
    return null;
  }

  function savePreference(language) {
    var normalized = normalizeLanguage(language);
    writeLocalStorage(PREFERENCE_KEY, normalized);
    document.cookie = PREFERENCE_KEY + "=" + encodeURIComponent(normalized) + "; Max-Age=31536000; Path=/; SameSite=Lax; Secure";
  }

  function getPreference() {
    var stored = readLocalStorage(PREFERENCE_KEY) || readCookie(PREFERENCE_KEY);
    return stored === "zh-cn" || stored === "en" ? stored : null;
  }

  function getRoutes() {
    var routes = {};
    var routeElements = document.querySelectorAll('meta[name="site-language-route"]');
    for (var index = 0; index < routeElements.length; index += 1) {
      var element = routeElements[index];
      routes[normalizeLanguage(element.getAttribute("data-language"))] = element.getAttribute("content");
    }
    return routes;
  }

  function readCachedCountry() {
    var value = readLocalStorage(REGION_KEY);
    if (!value) {
      return null;
    }

    try {
      var cached = JSON.parse(value);
      if (cached.expiresAt > Date.now() && typeof cached.country === "string") {
        return cached.country;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function cacheCountry(country, ttl) {
    writeLocalStorage(REGION_KEY, JSON.stringify({
      country: country,
      expiresAt: Date.now() + ttl
    }));
  }

  function browserFallbackCountry() {
    var timeZone = "";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (error) {
      timeZone = "";
    }

    var languages = window.navigator.languages || [window.navigator.language || ""];
    var usesMainlandChinese = Array.prototype.some.call(languages, function (language) {
      return String(language).toLowerCase() === "zh-cn";
    });

    return timeZone === "Asia/Shanghai" && usesMainlandChinese ? "CN" : "UNKNOWN";
  }

  function lookupCountry() {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = window.setTimeout(function () {
      if (controller) {
        controller.abort();
      }
    }, LOOKUP_TIMEOUT);

    return window.fetch(COUNTRY_ENDPOINT, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Country lookup failed");
      }
      return response.json();
    }).then(function (result) {
      var country = String(result.country || "").toUpperCase();
      if (!country) {
        throw new Error("Country lookup returned no country");
      }
      cacheCountry(country, REGION_TTL);
      return country;
    }).catch(function () {
      var country = browserFallbackCountry();
      cacheCountry(country, FAILURE_TTL);
      return country;
    }).then(function (country) {
      window.clearTimeout(timeout);
      return country;
    });
  }

  function desiredLanguage(country) {
    return country === "CN" ? "zh-cn" : "en";
  }

  function normalizePath(path) {
    var value = String(path || "/").replace(/\/index\.html$/, "/");
    return value.length > 1 ? value.replace(/\/$/, "") : value;
  }

  function redirectIfNeeded(language, routes, respectPreference) {
    var target = routes[language];
    if ((respectPreference && getPreference()) || !target || normalizePath(target) === normalizePath(window.location.pathname)) {
      return;
    }
    window.location.replace(target);
  }

  function bindLanguageChoices() {
    var choices = document.querySelectorAll("[data-language-choice]");
    for (var index = 0; index < choices.length; index += 1) {
      choices[index].addEventListener("click", function (event) {
        savePreference(event.currentTarget.getAttribute("data-language-choice"));
      });
    }
  }

  function start() {
    bindLanguageChoices();

    var routes = getRoutes();
    var preference = getPreference();
    if (preference) {
      redirectIfNeeded(preference, routes, false);
      return;
    }

    var cachedCountry = readCachedCountry();
    if (cachedCountry !== null) {
      redirectIfNeeded(desiredLanguage(cachedCountry), routes, true);
      return;
    }

    lookupCountry().then(function (country) {
      redirectIfNeeded(desiredLanguage(country), routes, true);
    });
  }

  start();
}());
