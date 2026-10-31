/* Maré on old iPhones (iOS 12): the few newer built-ins the app uses. Loaded first, only by the legacy copy. */
(function () {
  if (typeof globalThis === 'undefined') window.globalThis = window;
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (a, b) { return typeof a === 'string' ? this.split(a).join(b) : this.replace(a, b); };
  }
  if (!Promise.allSettled) {
    Promise.allSettled = function (list) {
      return Promise.all(Array.from(list, function (p) {
        return Promise.resolve(p).then(function (v) { return { status: 'fulfilled', value: v }; }, function (e) { return { status: 'rejected', reason: e }; });
      }));
    };
  }
  if (!window.queueMicrotask) window.queueMicrotask = function (f) { Promise.resolve().then(f); };
  if (!Object.fromEntries) {
    Object.fromEntries = function (it) { var o = {}; Array.from(it, function (kv) { o[kv[0]] = kv[1]; }); return o; };
  }
})();
