#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const routerSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "js", "language-routing.js"),
  "utf8"
);

function meta(attributes) {
  return {
    getAttribute(name) {
      return attributes[name] || null;
    },
    addEventListener() {}
  };
}

function runScenario({ pathname, currentLanguage, preference, routes, languageChoice }) {
  const redirects = [];
  const listeners = {};
  const routeElements = Object.entries(routes).map(([language, target]) => meta({
    "data-language": language,
    content: target
  }));
  const currentLanguageElement = meta({ content: currentLanguage });
  const choiceElement = languageChoice ? {
    getAttribute(name) {
      return languageChoice[name] || null;
    },
    addEventListener(name, handler) {
      listeners[name] = handler;
    }
  } : null;

  const document = {
    cookie: "",
    querySelectorAll(selector) {
      if (selector === 'meta[name="site-language-route"]') return routeElements;
      if (selector === "[data-language-choice]") return choiceElement ? [choiceElement] : [];
      return [];
    },
    querySelector(selector) {
      if (selector === 'meta[name="site-current-language"]') return currentLanguageElement;
      return null;
    }
  };

  const localStorage = {
    getItem(key) {
      return key === "bobo-language-preference" ? preference : null;
    },
    setItem() {}
  };

  const location = {
    pathname,
    replace(target) {
      redirects.push(target);
    },
    assign(target) {
      redirects.push(target);
    }
  };

  const window = {
    document,
    localStorage,
    location,
    navigator: { language: "en", languages: ["en"] },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(routerSource, {
    window,
    document,
    Intl,
    Date,
    JSON,
    String,
    Array,
    encodeURIComponent,
    decodeURIComponent,
    AbortController
  });

  if (choiceElement && listeners.click) {
    listeners.click({
      currentTarget: choiceElement,
      preventDefault() {}
    });
  }

  return redirects;
}

function expectRedirect(name, scenario, expected) {
  const actual = runScenario(scenario);
  const expectedList = expected ? [expected] : [];
  if (JSON.stringify(actual) !== JSON.stringify(expectedList)) {
    throw new Error(`${name}: expected ${JSON.stringify(expectedList)}, got ${JSON.stringify(actual)}`);
  }
}

const sectionRoutes = { "zh-cn": "/post/", en: "/en/post/" };

expectRedirect("Chinese pagination stays on page 2", {
  pathname: "/post/page/2/",
  currentLanguage: "zh-cn",
  preference: "zh-cn",
  routes: sectionRoutes
}, null);

expectRedirect("English pagination stays on page 3", {
  pathname: "/en/post/page/3/",
  currentLanguage: "en",
  preference: "en",
  routes: sectionRoutes
}, null);

expectRedirect("Chinese page 2 switches to English page 2", {
  pathname: "/post/page/2/",
  currentLanguage: "zh-cn",
  preference: "en",
  routes: sectionRoutes
}, "/en/post/page/2/");

expectRedirect("English page 3 switches to Chinese page 3", {
  pathname: "/en/post/page/3/",
  currentLanguage: "en",
  preference: "zh-cn",
  routes: sectionRoutes
}, "/post/page/3/");

expectRedirect("Chinese pagination language button opens English page 2", {
  pathname: "/post/page/2/",
  currentLanguage: "zh-cn",
  preference: "zh-cn",
  routes: sectionRoutes,
  languageChoice: {
    "data-language-choice": "en",
    href: "/en/post/"
  }
}, "/en/post/page/2/");

expectRedirect("English pagination language button opens Chinese page 3", {
  pathname: "/en/post/page/3/",
  currentLanguage: "en",
  preference: "en",
  routes: sectionRoutes,
  languageChoice: {
    "data-language-choice": "zh-cn",
    href: "/post/"
  }
}, "/post/page/3/");

expectRedirect("Chinese home opens Chinese About", {
  pathname: "/",
  currentLanguage: "zh-cn",
  preference: "zh-cn",
  routes: { "zh-cn": "/about/", en: "/en/about/" }
}, "/about/");

expectRedirect("English home opens English About", {
  pathname: "/en/",
  currentLanguage: "en",
  preference: "en",
  routes: { "zh-cn": "/about/", en: "/en/about/" }
}, "/en/about/");

expectRedirect("Article switches language without pagination suffix", {
  pathname: "/post/example/",
  currentLanguage: "zh-cn",
  preference: "en",
  routes: { "zh-cn": "/post/example/", en: "/en/post/example/" }
}, "/en/post/example/");

console.log("Language routing check passed: pagination, language switching, and About landing routes are preserved.");
