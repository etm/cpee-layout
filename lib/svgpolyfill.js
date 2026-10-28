/*
  This file is part of cpee-layout.

  cpee-layout is free software: you can redistribute it and/or modify it under
  the terms of the GNU General Public License as published by the Free Software
  Foundation, either version 3 of the License, or (at your option) any later
  version.

  cpee-layout is distributed in the hope that it will be useful, but WITHOUT
  ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
  FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more
  details.

  You should have received a copy of the GNU General Public License along with
  cpee-layout (file LICENSE in the main directory). If not, see
  <http://www.gnu.org/licenses/>.
*/

// SVG geometry for jsdom: getBBox, getScreenCTM, getCTM, createSVGPoint and
// createSVGMatrix, which jsdom does not implement. Follows what Chrome does:
// boxes ignore stroke and clipping, display:none subtrees are left out,
// visibility:hidden ones are not, and text boxes are the advance width times
// the font ascent plus descent. Text is shaped with fontkit, with the optical
// size axis set to the font size (font-optical-sizing: auto).

const fontkit = require('fontkit');
const { svgPathBbox } = require('svg-path-bbox');

const SVGNS = 'http://www.w3.org/2000/svg';
const HIDDEN = new Set(['defs', 'clipPath', 'marker', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'symbol', 'filter', 'title', 'desc', 'metadata', 'style', 'script']);
const PROPS = ['display', 'font-size', 'font-weight', 'text-anchor', 'transform'];

class Matrix { //{{{
  constructor(a=1,b=0,c=0,d=1,e=0,f=0) {
    Object.assign(this, {a,b,c,d,e,f});
  }
  multiply(m) {
    return new Matrix(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f
    );
  }
  inverse() {
    const det = this.a * this.d - this.b * this.c;
    return new Matrix(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det
    );
  }
  apply(x,y) {
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f };
  }
  map_rect(r) { // enclosing box of the transformed rect
    const p = [this.apply(r.x,r.y), this.apply(r.x+r.width,r.y), this.apply(r.x,r.y+r.height), this.apply(r.x+r.width,r.y+r.height)];
    const xs = p.map(q => q.x);
    const ys = p.map(q => q.y);
    return box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
} //}}}

class Point { //{{{
  constructor(x=0,y=0) {
    this.x = x;
    this.y = y;
  }
  matrixTransform(m) {
    const p = m.apply(this.x,this.y);
    return new Point(p.x,p.y);
  }
} //}}}

function box(x1,y1,x2,y2) { //{{{
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
} //}}}
function unite(a,b) { //{{{
  if (!a) { return b; }
  return box(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.max(a.x+a.width,b.x+b.width), Math.max(a.y+a.height,b.y+b.height));
} //}}}
function num(el,name,def=0) { //{{{
  const v = parseFloat(el.getAttribute(name));
  return isNaN(v) ? def : v;
} //}}}

function parse_transform(str) { //{{{ svg attribute and css syntax, units are dropped
  let m = new Matrix();
  if (!str || str == 'none') { return m; }
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str)) !== null) {
    const v = t[2].split(/[\s,]+/).filter(s => s != '').map(s => parseFloat(s));
    const rad = (v[0] || 0) * Math.PI / 180;
    switch (t[1]) {
      case 'matrix':     m = m.multiply(new Matrix(...v)); break;
      case 'translate':  m = m.multiply(new Matrix(1,0,0,1,v[0] || 0,v[1] || 0)); break;
      case 'translateX': m = m.multiply(new Matrix(1,0,0,1,v[0] || 0,0)); break;
      case 'translateY': m = m.multiply(new Matrix(1,0,0,1,0,v[0] || 0)); break;
      case 'scale':      m = m.multiply(new Matrix(v[0],0,0,v.length > 1 ? v[1] : v[0],0,0)); break;
      case 'rotate':
        if (v.length > 2) { m = m.multiply(new Matrix(1,0,0,1,v[1],v[2])); }
        m = m.multiply(new Matrix(Math.cos(rad),Math.sin(rad),-Math.sin(rad),Math.cos(rad),0,0));
        if (v.length > 2) { m = m.multiply(new Matrix(1,0,0,1,-v[1],-v[2])); }
        break;
      case 'skewX':      m = m.multiply(new Matrix(1,0,Math.tan(rad),1,0,0)); break;
      case 'skewY':      m = m.multiply(new Matrix(1,Math.tan(rad),0,1,0,0)); break;
    }
  }
  return m;
} //}}}

function specificity(sel) { //{{{
  const s = sel.replace(/::[\w-]+/g,'');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  const c = (s.replace(/\[[^\]]*\]/g,'').match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
  return a * 10000 + b * 100 + c;
} //}}}

class Styles { //{{{ a small cascade for the few properties that change geometry
  constructor(window,css) {
    const style = window.document.createElement('style');
    style.textContent = css;
    window.document.head.appendChild(style);
    this.rules = {};
    PROPS.forEach(p => this.rules[p] = []);
    let order = 0;
    for (const rule of style.sheet.cssRules) {
      if (!rule.selectorText) { continue; }
      for (const p of PROPS) {
        const value = rule.style.getPropertyValue(p);
        if (value == '') { continue; }
        const important = rule.style.getPropertyPriority(p) == 'important';
        rule.selectorText.split(',').forEach(sel => {
          this.rules[p].push({ sel: sel.trim(), spec: specificity(sel), important: important, order: order, value: value.trim() });
        });
      }
      order++;
    }
  }
  declared(el,prop) {
    const inline = (el.getAttribute('style') || '').split(';').map(d => d.split(':')).find(d => d.length > 1 && d[0].trim() == prop);
    if (inline) { return inline.slice(1).join(':').replace(/!important/,'').trim(); }
    let best = null;
    for (const r of this.rules[prop]) {
      let matches = false;
      try { matches = el.matches(r.sel); } catch (e) { }
      if (!matches) { continue; }
      if (!best || (r.important && !best.important) || (r.important == best.important && r.spec >= best.spec)) { best = r; }
    }
    if (best) { return best.value; }
    if (prop != 'transform' && el.hasAttribute(prop)) { return el.getAttribute(prop); } // presentation attribute
    return undefined;
  }
} //}}}

class Fonts { //{{{
  constructor(file) {
    this.font = fontkit.openSync(file);
    this.axes = this.font.variationAxes || {};
    this.instances = {};
    this.widths = {};
  }
  instance(weight,size) {
    const vary = {};
    if (this.axes.wght) { vary.wght = Math.min(Math.max(weight,this.axes.wght.min),this.axes.wght.max); }
    if (this.axes.opsz) { vary.opsz = Math.min(Math.max(size,this.axes.opsz.min),this.axes.opsz.max); }
    const key = JSON.stringify(vary);
    if (!this.instances[key]) {
      const def = Object.keys(vary).every(a => vary[a] == this.axes[a].default);
      this.instances[key] = def ? this.font : this.font.getVariation(vary);
    }
    return this.instances[key];
  }
  width(str,weight,size) {
    const key = weight + '|' + size + '|' + str;
    if (this.widths[key] === undefined) {
      const font = this.instance(weight,size);
      const run = font.layout(str);
      this.widths[key] = run.positions.reduce((s,p) => s + p.xAdvance, 0) * size / font.unitsPerEm;
    }
    return this.widths[key];
  }
  ascent(size)  { return Math.round(this.font.ascent * size / this.font.unitsPerEm); }
  descent(size) { return Math.round(-this.font.descent * size / this.font.unitsPerEm); }
} //}}}

class Geometry { //{{{
  constructor(styles,fonts) {
    this.styles = styles;
    this.fonts = fonts;
  }

  // computed values, cached for one measurement only, as classes change between measurements
  value(el,prop,cache) {
    let c = cache.get(el);
    if (!c) { c = {}; cache.set(el,c); }
    if (!(prop in c)) { c[prop] = this.styles.declared(el,prop); }
    return c[prop];
  }
  parent_element(el) {
    const p = el.parentNode;
    return (p && p.nodeType == 1) ? p : null;
  }
  font_size(el,cache) {
    const p = this.parent_element(el);
    const inherited = p ? this.font_size(p,cache) : 16;
    const v = this.value(el,'font-size',cache);
    if (v === undefined || v == 'inherit') { return inherited; }
    const keywords = { 'xx-small': 9, 'x-small': 10, 'small': 13, 'medium': 16, 'large': 18, 'x-large': 24, 'xx-large': 32 };
    if (keywords[v]) { return keywords[v]; }
    if (v == 'smaller') { return inherited / 1.2; }
    if (v == 'larger') { return inherited * 1.2; }
    const n = parseFloat(v);
    if (isNaN(n)) { return inherited; }
    if (v.endsWith('em')) { return n * inherited; }
    if (v.endsWith('%')) { return n * inherited / 100; }
    if (v.endsWith('pt')) { return n * 4 / 3; }
    return n;
  }
  font_weight(el,cache) {
    const p = this.parent_element(el);
    const inherited = p ? this.font_weight(p,cache) : 400;
    const v = this.value(el,'font-weight',cache);
    if (v === undefined || v == 'inherit') { return inherited; }
    if (v == 'normal') { return 400; }
    if (v == 'bold') { return 700; }
    if (v == 'bolder') { return inherited < 600 ? 700 : 900; }
    if (v == 'lighter') { return inherited < 600 ? 100 : 400; }
    const n = parseFloat(v);
    return isNaN(n) ? inherited : n;
  }
  text_anchor(el,cache) {
    const v = this.value(el,'text-anchor',cache);
    if (v !== undefined && v != 'inherit') { return v; }
    const p = this.parent_element(el);
    return p ? this.text_anchor(p,cache) : 'start';
  }
  hidden(el,cache) {
    return this.value(el,'display',cache) == 'none';
  }
  local_transform(el,cache) {
    const css = this.value(el,'transform',cache);
    return parse_transform(css !== undefined ? css : el.getAttribute('transform'));
  }

  // bounding box of an element in its own user space, null if it adds nothing
  bbox(el,cache) {
    switch (el.localName) {
      case 'rect':
        return box(num(el,'x'), num(el,'y'), num(el,'x') + Math.max(num(el,'width'),0), num(el,'y') + Math.max(num(el,'height'),0));
      case 'circle': {
        const r = Math.max(num(el,'r'),0);
        return box(num(el,'cx') - r, num(el,'cy') - r, num(el,'cx') + r, num(el,'cy') + r);
      }
      case 'ellipse': {
        const rx = Math.max(num(el,'rx'),0);
        const ry = Math.max(num(el,'ry'),0);
        return box(num(el,'cx') - rx, num(el,'cy') - ry, num(el,'cx') + rx, num(el,'cy') + ry);
      }
      case 'line':
        return box(Math.min(num(el,'x1'),num(el,'x2')), Math.min(num(el,'y1'),num(el,'y2')), Math.max(num(el,'x1'),num(el,'x2')), Math.max(num(el,'y1'),num(el,'y2')));
      case 'polyline':
      case 'polygon': {
        const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(s => parseFloat(s)).filter(n => !isNaN(n));
        if (v.length < 2) { return box(0,0,0,0); }
        const xs = v.filter((_,i) => i % 2 == 0);
        const ys = v.filter((_,i) => i % 2 == 1);
        return box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      }
      case 'path': {
        const d = el.getAttribute('d');
        if (!d || d.trim() == '') { return box(0,0,0,0); }
        const b = svgPathBbox(d);
        return box(b[0],b[1],b[2],b[3]);
      }
      case 'text':
        return this.text_bbox(el,cache);
      case 'g':
      case 'svg':
      case 'a':
      case 'switch':
        return this.group_bbox(el,cache);
      default:
        return null;
    }
  }
  group_bbox(el,cache) {
    let r = null;
    for (const c of el.children) {
      if (c.namespaceURI != SVGNS || HIDDEN.has(c.localName) || this.hidden(c,cache)) { continue; }
      const b = this.bbox(c,cache);
      if (!b) { continue; } // empty groups do not count, empty shapes do
      r = unite(r, this.local_transform(c,cache).map_rect(b));
    }
    return r;
  }
  text_bbox(el,cache) {
    const segments = [];
    const chunks = [];
    let chunk = null;
    let x = 0;
    let y = 0;
    let space = true; // whitespace is collapsed over the whole text, leading whitespace dropped
    const first = (e,name) => {
      const v = (e.getAttribute(name) || '').trim().split(/[\s,]+/)[0];
      const n = parseFloat(v);
      return isNaN(n) ? undefined : n;
    };
    const walk = (e) => {
      if (this.hidden(e,cache)) { return; }
      if (first(e,'x') !== undefined || chunk == null) {
        if (first(e,'x') !== undefined) { x = first(e,'x'); }
        chunk = { anchor: this.text_anchor(e,cache), segments: [] };
        chunks.push(chunk);
      }
      if (first(e,'y') !== undefined) { y = first(e,'y'); }
      x += first(e,'dx') || 0;
      y += first(e,'dy') || 0;
      const size = this.font_size(e,cache);
      const weight = this.font_weight(e,cache);
      for (const n of e.childNodes) {
        if (n.nodeType == 1 && n.namespaceURI == SVGNS && n.localName == 'tspan') {
          walk(n);
        } else if (n.nodeType == 3 || n.nodeType == 4) {
          let str = '';
          for (const ch of n.data.replace(/[\n\r\t]/g,' ')) {
            if (ch == ' ' && space) { continue; }
            str += ch;
            space = (ch == ' ');
          }
          if (str == '') { continue; }
          const s = { str: str, size: size, weight: weight, x: x, y: y, width: this.fonts.width(str,weight,size) };
          x += s.width;
          segments.push(s);
          chunk.segments.push(s);
        }
      }
    };
    walk(el);
    const last = segments[segments.length - 1];
    if (last && last.str.endsWith(' ')) { // trailing whitespace is dropped
      last.str = last.str.slice(0,-1);
      last.width = this.fonts.width(last.str,last.weight,last.size);
    }
    let r = null;
    chunks.forEach(c => {
      if (c.segments.length == 0) { return; }
      const start = c.segments[0].x;
      const end = c.segments[c.segments.length - 1].x + c.segments[c.segments.length - 1].width;
      const shift = c.anchor == 'middle' ? -(end - start) / 2 : (c.anchor == 'end' ? -(end - start) : 0);
      c.segments.forEach(s => {
        r = unite(r, box(s.x + shift, s.y - this.fonts.ascent(s.size), s.x + shift + s.width, s.y + this.fonts.descent(s.size)));
      });
    });
    return r || box(0,0,0,0);
  }
  ctm(el) { // from the outermost svg to the element, including its own transform
    const chain = [];
    for (let e = el; e && e.nodeType == 1 && e.namespaceURI == SVGNS; e = e.parentNode) { chain.unshift(e); }
    const cache = new Map();
    let m = new Matrix();
    chain.slice(1).forEach(e => { m = m.multiply(this.local_transform(e,cache)); });
    return m;
  }
} //}}}

// window: a jsdom window, css: the stylesheet text that decides font sizes and
// what is hidden, font: path to the font file used for all text
function install(window,css,font) { //{{{
  const geometry = new Geometry(new Styles(window,css), new Fonts(font));
  const protos = [window.SVGElement.prototype];
  if (window.SVGGraphicsElement) { protos.push(window.SVGGraphicsElement.prototype); }
  const define = (proto,name,fn) => Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  protos.forEach(proto => {
    define(proto,'getBBox',function() {
      const b = geometry.bbox(this,new Map()) || box(0,0,0,0);
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    define(proto,'getScreenCTM',function() { return geometry.ctm(this); });
    define(proto,'getCTM',function() { return geometry.ctm(this); });
  });
  define(window.SVGSVGElement.prototype,'createSVGPoint',function() { return new Point(); });
  define(window.SVGSVGElement.prototype,'createSVGMatrix',function() { return new Matrix(); });
  return geometry;
} //}}}

module.exports = { install, Matrix, Point, parse_transform };
