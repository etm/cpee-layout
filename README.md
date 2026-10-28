# CPEE Layout

Themable, flexible BPMN auto-layout library. Visualization and editing.
Event-driven. Minimal dependencies (jQuery).

See [THEMES.MD](THEMES.MD) for the guide on building your own theme.

## Command line tools

Two tools render a model without a browser: wfadaptor.js runs inside jsdom,
with text measured from AdwaitaSans-Regular.ttf. They need Node.js 22.22 or
newer. Install the dependencies first:

```sh
npm install
```

Both take a CPEE model (root `<description>`) or a testset, which contains the
model as a `<description>` in the `http://cpee.org/ns/description/1.0` namespace.
The preset theme is used by default, `-lr` uses presetlr (left to right).

### svgexport

```sh
bin/svgexport [-lr] [-o FILE] [--embed-font] MODEL|TESTSET
```

Writes a standalone SVG, the same as the cockpit's SVG export (`get_svg()` in
wfadaptor.js): the CSS is inlined into style attributes, so no stylesheet is
needed. Text uses the font "Adwaita Sans", which has to be installed where
the SVG is viewed, or embedded with `--embed-font` (about 1.2 MB more).

```sh
bin/svgexport model.xml > model.svg
bin/svgexport -lr -o model-lr.svg model.xml
```

Label widths come from the font outlines. Chrome on Linux hints the text and
draws it a little wider, so labels there can lose their last letter.

### svgmetrics

```sh
bin/svgmetrics [-lr] [-o FILE] MODEL|TESTSET
```

Writes the layout as pretty-printed JSON (`get_svg_metrics()` in
wfadaptor.js): `pos_matrix` holds the placed symbols per row and column
(`x`, `width`, `type`, `label`, `eid`, empty cells are `null`), `con_list` the
connections between them.

```sh
bin/svgmetrics model.xml > model.json
```

