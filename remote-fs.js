// FS compatibility from upstream web/app.js; see THIRD-PARTY-NOTICES.md.
Module.preRun = [function () {
    var orig = FS.lookupPath;
    function child(node, name) {
      if (!node || !node.contents) return null;
      if (node.contents[name]) return { name: name, node: node.contents[name] };
      var want = name.toLowerCase();
      for (var k in node.contents) {
        if (k.toLowerCase() === want) return { name: k, node: node.contents[k] };
      }
      return null;
    }
    FS.lookupPath = function (path, opts) {
      if (typeof path === 'string') path = path.split('\\').join('/');
      var exact;
      try {
        exact = orig(path, opts);
      } catch (err) {
        if (!err || err.errno !== 44) throw err;
        exact = null;
      }
      if (exact && exact.node) return exact;
      var abs = PATH.isAbs(path) ? path : (FS.cwd() + '/' + path);
      var parts = abs.split('/').filter(function (p) { return p && p !== '.'; });
      var node = FS.root;
      var built = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '..') {
          built.pop();
          node = (node && node.parent) || FS.root;
          continue;
        }
        var hit = child(node, parts[i]);
        if (!hit) {
          if (exact) return exact;
          throw new FS.ErrnoError(44);
        }
        built.push(hit.name);
        node = hit.node;
        if (node && node.mounted && node.mounted.root && i !== parts.length - 1)
          node = node.mounted.root;
      }
      return orig('/' + built.join('/'), opts);
    };
  }];
