/*
  This file is part of cpee-layout.

  cpee-layout is free software: you can redistribute it and/or modify it under
  the terms of the GNU Lesser General Public License as published by the Free
  Software Foundation, either version 3 of the License, or (at your option) any
  later version.

  cpee-layout is distributed in the hope that it will be useful, but WITHOUT
  ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
  FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public License for more
  details.

  You should have received a copy of the GNU Lesser General Public License
  along with cpee-layout (file LICENSE in the main directory). If not, see
  <http://www.gnu.org/licenses/>.
*/

// Draws a CPEE model or testset the same way index.html does in the browser:
// wfadaptor.js runs inside jsdom, and svgpolyfill.js provides the measurements
// that jsdom lacks. Shared by the command line tools in bin/.

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const svgpolyfill = require('./svgpolyfill.js');

const ROOT = path.resolve(__dirname, '..');
const CPEENS = 'http://cpee.org/ns/description/1.0';
const FONT = path.join(ROOT, 'AdwaitaSans-Regular.ttf');

// usage: the help text. flags: further boolean options, e.g. { '--embed-font': 'embed_font' }
function parse_args(argv,usage,flags={}) { //{{{
  const help = (code) => {
    (code == 0 ? process.stdout : process.stderr).write(usage);
    process.exit(code);
  };
  const opts = { theme: 'themes/preset/theme.js', output: null, input: null };
  Object.values(flags).forEach(f => opts[f] = false);
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-lr': opts.theme = 'themes/presetlr/theme.js'; break;
      case '-o': opts.output = argv[++i]; break;
      case '-h':
      case '--help': help(0);
      default:
        if (argv[i] in flags) { opts[flags[argv[i]]] = true; break; }
        if (argv[i].startsWith('-') || opts.input) { help(1); }
        opts.input = argv[i];
    }
  }
  if (!opts.input || (argv.includes('-o') && !opts.output)) { help(1); }
  return opts;
} //}}}

// resolves to { window, $, graphrealization } after the model in file is drawn
async function render(file,theme) { //{{{
  const input = fs.readFileSync(file, 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'wfadaptor.css'), 'utf8');

  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><style data-include-export="true"></style></head><body>' +
    '<div id="graphgrid"><svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:x="http://www.w3.org/1999/xlink" id="graphcanvas" width="1" height="1"></svg></div>' +
    '</body></html>',
    { runScripts: 'outside-only' }
  );
  const window = dom.window;
  window.document.querySelector('style[data-include-export]').textContent = css; // what get_svg inlines
  svgpolyfill.install(window, css, FONT);

  // the same libs index.html loads from js_libs, as browser scripts in the window
  window.eval(fs.readFileSync(require.resolve('jquery/dist/jquery.min.js'), 'utf8'));
  window.eval(fs.readFileSync(require.resolve('uidashjs/uidash_util.js'), 'utf8'));
  const $ = window.jQuery;

  // themes and symbols come from the file system instead of http
  const run = (url) => window.eval(fs.readFileSync(path.resolve(ROOT, url), 'utf8') + '\n//# sourceURL=' + url);
  let fail = (e) => { throw e; }; // $.when never calls back on errors, so loading errors end the export directly
  $.ajax = function(o) { // asynchronous like the real one, loadTheme relies on it (shared illustrator objects)
    const d = $.Deferred();
    setImmediate(() => {
      try {
        const doc = $.parseXML(fs.readFileSync(path.resolve(ROOT, o.url), 'utf8'));
        if (o.success) { o.success.call(o.context, doc); }
        d.resolveWith(o.context, [doc]);
      } catch (e) {
        fail(new Error('could not load ' + o.url + ': ' + e.message));
      }
    });
    return d.promise();
  };
  $.getScript = function(url,success) {
    const d = $.Deferred();
    try {
      run(url);
      if (success) { success(); }
      d.resolve();
    } catch (e) {
      d.reject(e);
    }
    return d.promise();
  };
  run('themes/base.js');
  run('wfadaptor.js');

  let data = $.parseXML(input);
  if (data.documentElement.nodeName != 'description') { // testset: the model is the description inside, either wrapped in a <description> or not
    const model = data.getElementsByTagNameNS(CPEENS, 'description')[0];
    if (!model) { throw new Error(file + ' contains no ' + CPEENS + ' description'); }
    data = $.parseXML(new window.XMLSerializer().serializeToString(model));
  }

  const graphrealization = await new Promise((resolve,reject) => {
    fail = reject;
    new window.WfAdaptor(theme, function(graphrealization) {
      try {
        graphrealization.set_svg_container($('#graphcanvas'));
        graphrealization.set_label_container($('#graphgrid'));
        graphrealization.set_description($(data), true);
        resolve(graphrealization);
      } catch (e) {
        reject(e);
      }
    });
  });
  return { window, $, graphrealization };
} //}}}

function write(opts,out) { //{{{
  if (opts.output) {
    fs.writeFileSync(opts.output, out);
  } else {
    process.stdout.write(out);
  }
} //}}}

function run(name,main) { //{{{
  main().catch((e) => {
    process.stderr.write(name + ': ' + (e && e.stack ? e.stack : e) + '\n');
    process.exit(1);
  });
} //}}}

module.exports = { parse_args, render, write, run, FONT };
