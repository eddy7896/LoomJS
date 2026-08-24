import { describe, expect, it } from 'vitest';
import { createComponent } from '@loom/components';
import type { Component, Snapshot } from '@loom/ir';
import { compile } from '../src';
import { supabaseSnapshot, trivialSnapshot } from './fixtures';

/**
 * Media elements (`docs/28-media.md`).
 *
 * What is checked here is mostly *what the browser is told* — muted with autoplay, lazy with an
 * embed, a title on an iframe. Those are the details that are invisible when they are wrong: the
 * video simply does not start, and the screen reader simply says "frame".
 */

function withMedia(type: string, props: Record<string, unknown> = {}): string {
  const base: Snapshot = trivialSnapshot();
  const component: Component = createComponent(type, `cp_${type.toLowerCase()}`);
  for (const [key, value] of Object.entries(props)) {
    component.props[key] = { kind: 'static', value: value as string | number | boolean };
  }

  const root = base.components.cp_root000001!;
  const snapshot: Snapshot = {
    ...base,
    components: {
      ...base.components,
      cp_root000001: { ...root, children: [...(root.children ?? []), component.id] },
      [component.id]: component,
    },
  };

  return compile(snapshot).files.find((file) => file.path.startsWith('src/artboards/'))!.content;
}

describe('Video', () => {
  it('is the browser’s own player, with its own controls', () => {
    const code = withMedia('Video', { src: 'clip.mp4' });
    expect(code).toContain('<video');
    expect(code).toContain('controls');
    // No library, no wrapper: a player that ships a megabyte to redraw the controls people already
    // know is worse on a phone than the one that was already there.
    expect(code).not.toContain('react-player');
  });

  it('mutes anything that plays by itself', () => {
    // Every browser blocks sound that starts on its own, so autoplay without muted is a video that
    // silently does not start — which looks like a broken element rather than a policy.
    const code = withMedia('Video', { src: 'clip.mp4', autoplay: true, muted: false });
    expect(code).toContain('autoPlay');
    expect(code).toContain('muted');
  });

  it('stays inside the page on iOS', () => {
    // Without this, iOS takes any playing video fullscreen, which is not what a video inside a
    // layout is for.
    expect(withMedia('Video', { src: 'clip.mp4' })).toContain('playsInline');
  });

  it('carries a poster when one is given, and nothing when one is not', () => {
    expect(withMedia('Video', { src: 'a.mp4', poster: 'cover.jpg' })).toContain('poster={"cover.jpg"}');
    expect(withMedia('Video', { src: 'a.mp4' })).not.toContain('poster=');
  });
});

describe('Audio', () => {
  it('emits a real audio element with controls', () => {
    const code = withMedia('Audio', { src: 'song.mp3' });
    expect(code).toContain('<audio');
    expect(code).toContain('controls');
  });

  it('drops the controls when they are turned off', () => {
    const code = withMedia('Audio', { src: 'song.mp3', controls: false });
    expect(code).toContain('<audio');
    expect(code).not.toMatch(/<audio[^>]*\n\s*controls/);
  });
});

describe('Carousel', () => {
  it('holds its index as real state', () => {
    const code = withMedia('Carousel', { items: 'a.jpg, b.jpg, c.jpg' });
    // The same mechanism a List's paging uses. A CSS-only carousel cannot be driven from a
    // keyboard and cannot say which slide it is on.
    expect(code).toContain('useState(0)');
    expect(code).toContain('["a.jpg","b.jpg","c.jpg"]');
  });

  it('gives the controls names a screen reader can read', () => {
    const code = withMedia('Carousel', { items: 'a.jpg, b.jpg' });
    expect(code).toContain('aria-label="Previous"');
    expect(code).toContain('aria-label="Next"');
    expect(code).toContain('aria-current=');
  });

  it('wraps at both ends rather than stopping', () => {
    const code = withMedia('Carousel', { items: 'a.jpg, b.jpg' });
    // Modulo, so the timer can count up forever and removing pictures cannot strand it past the
    // end of what is left.
    expect(code).toMatch(/% slides_\w+\.length/);
  });

  it('does not move on its own unless it was asked to', () => {
    expect(withMedia('Carousel', { items: 'a.jpg, b.jpg' })).not.toContain('setInterval');
  });

  it('clears its timer when it does', () => {
    const code = withMedia('Carousel', { items: 'a.jpg, b.jpg', interval: 4 });
    expect(code).toContain('setInterval');
    expect(code).toContain('clearInterval');
    expect(code).toContain('4000');
    // A timer that outlives the screen it belongs to is a leak that keeps setting state on
    // something that is gone.
    expect(code).toContain('return () => clearInterval');
  });

  it('reads a named column when the pictures come from data', () => {
    // Typed in, the pictures are a comma-separated list and the column name is irrelevant. Bound,
    // they are rows — and this is the column that holds the address.
    const base = supabaseSnapshot();
    const root = base.components.cp_root000001!;
    const carousel: Component = {
      id: 'cp_carousel',
      type: 'Carousel',
      name: 'Photos',
      props: {
        items: { kind: 'bound', source: { nodeId: 'nd_read', portId: 'pt_result' } },
        field: { kind: 'static', value: 'photo' },
        dots: { kind: 'static', value: true },
      },
    };

    const code = compile({
      ...base,
      components: {
        ...base.components,
        cp_root000001: { ...root, children: [...(root.children ?? []), carousel.id] },
        [carousel.id]: carousel,
      },
    }).files.find((file) => file.path.startsWith('src/artboards/'))!.content;

    expect(code).toContain('"photo"');
    // And the rows themselves are the addresses when no column is named, which is what a list of
    // plain strings looks like.
    expect(code).toContain('.filter(Boolean)');
  });
});

describe('Tiles', () => {
  it('wraps by width rather than by count', () => {
    const code = withMedia('Tiles', { minWidth: 200, gap: 8 });
    // The one arrangement the row/column layout genuinely cannot express, which is what earns it
    // an element of its own.
    expect(code).toContain('repeat(auto-fill, minmax(200px, 1fr))');
    expect(code).toContain('"8px"');
  });

  it('refuses a nonsense minimum rather than emitting a broken grid', () => {
    expect(withMedia('Tiles', { minWidth: -40 })).toContain('minmax(40px, 1fr)');
  });
});

describe('Avatar', () => {
  it('falls back to initials, worked out where the name is', () => {
    const code = withMedia('Avatar', { src: 'face.jpg', name: 'Ada Lovelace' });
    // An avatar bound to rows of people will sometimes have no picture, and a broken-image icon in
    // a list of names reads as a bug in the app rather than a gap in the data.
    expect(code).toContain('toUpperCase()');
    expect(code).toContain('<img');
  });

  it('is only the initials when there is no picture at all', () => {
    const code = withMedia('Avatar', { name: 'Grace Hopper' });
    expect(code).not.toContain('<img');
    expect(code).toContain('aria-label=');
  });
});

describe('Embed', () => {
  it('tells the embedded host nothing about where it was loaded', () => {
    const code = withMedia('Embed', { src: 'https://example.com/map', title: 'Where we are' });
    expect(code).toContain('<iframe');
    expect(code).toContain('referrerPolicy="no-referrer"');
    // An embed below the fold costs nothing until it is reached.
    expect(code).toContain('loading="lazy"');
    expect(code).toContain('title={"Where we are"}');
  });

  it('refuses a frame with no title', () => {
    // A screen reader announces an untitled iframe as "frame", which says nothing about what is in
    // it — and unlike an image's empty alt, there is no reading of a blank title that is a decision.
    expect(() => withMedia('Embed', { src: 'https://example.com', title: '  ' })).toThrow(/title/i);
  });

  it('refuses an embed with nowhere to point', () => {
    expect(() => withMedia('Embed', { src: '' })).toThrow(/address/i);
  });
});

describe('every media element', () => {
  it('carries its variant classes', () => {
    for (const [type, expected] of [
      ['Video', 'loom-video'],
      ['Audio', 'loom-audio'],
      ['Carousel', 'loom-carousel'],
      ['Tiles', 'loom-tiles'],
      ['Avatar', 'loom-avatar'],
      ['Embed', 'loom-embed'],
    ] as const) {
      expect(withMedia(type, { items: 'a.jpg' }), `${type} is unstyled`).toContain(
        `className="${expected}`,
      );
    }
  });
});

describe('an element keeps the size it was drawn at', () => {
  it('carries a leaf’s width and height into the emitted app', () => {
    // This was dropped on the floor: only containers passed their layout to the style, so a Text
    // dragged out to 320 pixels emitted a span that hugged its word and the canvas and the running
    // app disagreed about the shape of the screen. Media made it visible — a carousel with no size
    // collapses to nothing and takes its controls with it — but it was never only about media.
    const base = trivialSnapshot();
    const text = base.components.cp_text000001!;
    const code = compile({
      ...base,
      components: {
        ...base.components,
        cp_text000001: {
          ...text,
          layout: {
            direction: 'column',
            gap: 0,
            padding: 0,
            align: 'stretch',
            justify: 'start',
            size: { width: { mode: 'fixed', px: 320 }, height: { mode: 'fixed', px: 64 } },
          },
        },
      },
    }).files.find((file) => file.path.startsWith('src/artboards/'))!.content;

    expect(code).toContain('width: 320');
    expect(code).toContain('height: 64');
  });

  it('gives a carousel somewhere to draw', () => {
    const code = withMedia('Carousel', { items: 'a.jpg, b.jpg' });
    // 480x300 by default, because a carousel has no content to hug.
    expect(code).toMatch(/width: 480/);
  });
});
