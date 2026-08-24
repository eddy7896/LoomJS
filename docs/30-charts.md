# 30 — Charts

A project could fetch a thousand rows and show them as a thousand rows. There was no way to say
"how did sales go this year" — so every project that needed a chart needed a developer.

Four elements, in a **Charts** section of the palette:

| Element | What it says | Shapes |
| --- | --- | --- |
| **Bar chart** | How categories compare | vertical · horizontal |
| **Line chart** | How something moved over time | line · smooth · area |
| **Pie chart** | How a whole is divided | pie · donut |
| **Stat** | One number, large, with what it is | plain · card |

## Drawn, not installed

They emit **inline SVG the project owns**. No charting library, no runtime, nothing to install.

That is the same rule the icons follow, and for the same reason: a dependency whose whole job is
drawing shapes is a dependency the emitted app should not carry. A charting library is a few hundred
kilobytes, a version to keep up with, and an API that decides what your chart can look like. Sixty
lines of `<path>` arithmetic is none of those things.

What it costs is the exotic end — no zoom, no brushing, no thirty chart types. A project that
outgrows these owns its code and can install whatever it likes; nothing here is in the way.

## How a chart gets its data

The same way a List or a Table does: `items` is bound to rows, and two properties name the columns.

- **Labels** — the column down the bottom, or beside each slice.
- **Values** — the column that becomes the height, the point or the wedge.

A value that is not a number counts as zero rather than breaking the chart, because one bad row in a
thousand should not blank a dashboard. A chart with no rows at all says so, exactly as a List does.

## Decisions worth writing down

- **The axis starts at zero.** A bar chart that starts at 40 makes a 3% difference look like a
  doubling. That is the oldest way to lie with a chart, and it is not going to be the default here.
- **The scale is rounded outwards** to something a person can read — 0, 250, 500 rather than 0, 237,
  474. The top of the axis is a number worth printing.
- **Colour comes from the tokens**, like everything else. A pie's slices are the brand colour at
  falling opacity rather than six invented hues: it stays legible when the project restyles, and
  there is no rainbow nobody chose.
- **Every chart is labelled for a screen reader.** `role="img"` and a sentence saying what it shows
  and what the numbers are. A chart that is invisible to a screen reader is a chart that says
  nothing at all to some of the people looking at the page.
- **The canvas draws sample data.** There is no data in the editor, so a chart on the artboard shows
  a made-up series — the same honesty as a Table's ghost rows. What is being judged there is the
  size and the shape, and both are real.

## What is deliberately not here

- **No second axis.** Two scales on one chart is the second oldest way to lie with one.
- **No 3D, no shadows on the data.** Depth on a bar is decoration that changes how long the bar
  looks.
- **No live streaming.** A chart redraws when the data it is bound to changes; making that data
  arrive is the query's business, not the chart's.
