/* globals XPCOMUtils, NetUtil, PlacesUtils, Task */
"use strict";

const {before} = require("sdk/test/utils");
const {PlacesProvider} = require("lib/PlacesProvider");
const {PlacesTestUtils} = require("./lib/PlacesTestUtils");
const {Ci, Cu} = require("chrome");

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils",
                                  "resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
    "resource://gre/modules/NetUtil.jsm");

exports.test_LinkChecker_securityCheck = function(assert) {
  let urls = [
    {url: "file://home/file/image.png", expected: false},
    {url: "resource:///modules/PlacesProvider.jsm", expected: false},
    {url: "javascript:alert('hello')", expected: false}, // jshint ignore:line
    {url: "data:image/png;base64,XXX", expected: false},
    {url: "about:newtab", expected: true},
    {url: "https://example.com", expected: true},
    {url: "ftp://example.com", expected: true},
  ];
  for (let {url, expected} of urls) {
    let observed = PlacesProvider.LinkChecker.checkLoadURI(url);
    assert.equal(observed, expected, `can load "${url}"?`);
  }
};

exports.test_Links_getTopFrecentSites = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;

    let links = yield provider.getTopFrecentSites();
    assert.equal(links.length, 0, "empty history yields empty links");

    // add a visit
    let testURI = NetUtil.newURI("http://mozilla.com");
    let numAdded = yield PlacesTestUtils.addVisits(testURI);
    assert.equal(numAdded, 1, "correct number added");

    links = yield provider.getTopFrecentSites();
    assert.equal(links.length, 1, "adding a visit yields a link");
    assert.equal(links[0].url, testURI.spec, "added visit corresponds to added url");
  }).then(done);
};

exports.test_Links_getTopFrecentSites_Order = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;
    let {
      TRANSITION_TYPED,
      TRANSITION_LINK
    } = PlacesUtils.history;

    function timeDaysAgo(numDays) {
      let now = new Date();
      return now.getTime() - (numDays * 24 * 60 * 60 * 1000);
    }

    let timeEarlier = timeDaysAgo(0);
    let timeLater = timeDaysAgo(2);

    let visits = [
      // frecency 200
      {uri: NetUtil.newURI("https://mozilla1.com/0"), visitDate: timeEarlier, transition: TRANSITION_TYPED},
      // sort by url, frecency 200
      {uri: NetUtil.newURI("https://mozilla2.com/1"), visitDate: timeEarlier, transition: TRANSITION_TYPED},
      // sort by last visit date, frecency 200
      {uri: NetUtil.newURI("https://mozilla3.com/2"), visitDate: timeLater, transition: TRANSITION_TYPED},
      // sort by frecency, frecency 10
      {uri: NetUtil.newURI("https://mozilla4.com/3"), visitDate: timeLater, transition: TRANSITION_LINK},
    ];

    let links = yield provider.getTopFrecentSites();
    assert.equal(links.length, 0, "empty history yields empty links");
    let numAdded = yield PlacesTestUtils.addVisits(visits);
    assert.equal(numAdded, visits.length, "correct number added");

    links = yield provider.getTopFrecentSites();
    assert.equal(links.length, visits.length, "number of links added is the same as obtain by getTopFrecentSites");
    for (let i = 0; i < links.length; i++) {
      assert.equal(links[i].url, visits[i].uri.spec, "links are obtained in the expected order");
    }
  }).then(done);
};

exports.test_Links_onLinkChanged = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;
    provider.init();
    assert.equal(true, true);

    let url = "https://example.com/onFrecencyChanged1";
    let linkChangedMsgCount = 0;

    let linkChangedPromise = new Promise(resolve => {
      let handler = (_, link) => { // jshint ignore:line
        /* There are 3 linkChanged events:
         * 1. visit insertion (-1 frecency by default)
         * 2. frecency score update (after transition type calculation etc)
         * 3. title change
         */
        if (link.url === url) {
          assert.equal(link.url, url, `expected url on linkChanged event`);
          linkChangedMsgCount += 1;
          if (linkChangedMsgCount === 3) {
            assert.ok(true, `all linkChanged events captured`);
            provider.off("linkChanged", this);
            resolve();
          }
        }
      };
      provider.on("linkChanged", handler);
    });

    // add a visit
    let testURI = NetUtil.newURI(url);
    let numAdded = yield PlacesTestUtils.addVisits(testURI);
    assert.equal(numAdded, 1, "correct number added");
    yield linkChangedPromise;

    provider.uninit();
  }).then(done);
};

exports.test_Links_onClearHistory = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;
    provider.init();

    let clearHistoryPromise = new Promise(resolve => {
      let handler = () => {
        assert.ok(true, `clearHistory event captured`);
        provider.off("clearHistory", handler);
        resolve();
      };
      provider.on("clearHistory", handler);
    });

    // add visits
    for (let i = 0; i <= 10; i++) {
      let url = `https://example.com/onClearHistory${i}`;
      let testURI = NetUtil.newURI(url);
      let numAdded = yield PlacesTestUtils.addVisits(testURI);
      assert.equal(numAdded, 1, "correct number added");
    }
    yield PlacesTestUtils.clearHistory();
    yield clearHistoryPromise;
    provider.uninit();
  }).then(done);
};

exports.test_Links_onDeleteURI = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;
    provider.init();

    let testURL = "https://example.com/toDelete";

    let deleteURIPromise = new Promise(resolve => {
      let handler = (_, {url}) => { // jshint ignore:line
        assert.equal(testURL, url, "deleted url and expected url are the same");
        provider.off("deleteURI", handler);
        resolve();
      };

      provider.on("deleteURI", handler);
    });

    let testURI = NetUtil.newURI(testURL);
    let numAdded = yield PlacesTestUtils.addVisits(testURI);
    assert.equal(numAdded, 1, "correct number added");
    yield PlacesUtils.history.remove(testURL);
    yield deleteURIPromise;
    provider.uninit();
  }).then(done);
};

exports.test_Links_onManyLinksChanged = function(assert, done) {
  Task.spawn(function*() {
    let provider = PlacesProvider.links;
    provider.init();

    let promise = new Promise(resolve => {
      let handler = () => {
        assert.ok(true);
        provider.off("manyLinksChanged", handler);
        resolve();
      };

      provider.on("manyLinksChanged", handler);
    });

    let testURL = "https://example.com/toDelete";
    let testURI = NetUtil.newURI(testURL);
    let numAdded = yield PlacesTestUtils.addVisits(testURI);
    assert.equal(numAdded, 1, "correct number added");

    // trigger DecayFrecency
    PlacesUtils.history.QueryInterface(Ci.nsIObserver).
      observe(null, "idle-daily", "");

    yield promise;
    provider.uninit();
  }).then(done);
};

before(exports, function(name, assert, done) {
  Task.spawn(function*() {
    yield PlacesTestUtils.clearHistory();
  }).then(done);
});

require("sdk/test").run(exports);
