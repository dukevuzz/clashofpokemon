# A landing page, and a site a crawler can read

## Why

Searching "clash of pokemon" does not find this game. It finds somebody else's.

That is not a ranking loss, it is an absence: the site has never been indexable.
`client/index.html` carries a `<title>`, a viewport, a theme colour and the
copyright notice, and nothing else. No description, no `og:`, no canonical, no
`robots.txt`, no `sitemap.xml`. The `<body>` is one `<div id="game">` that
Phaser fills with a canvas, so there is no text on the page at all. Google has
nothing to read and nothing to quote.

Measured 2026-10-15:

| | ours | the one that ranks |
|---|---|---|
| `<meta name="description">` | absent | present |
| `og:` / `twitter:` | absent | full set, 1200x630 image |
| `canonical` | absent | present |
| `robots.txt` | returns `index.html` | real |
| `sitemap.xml` | returns `index.html` | real |
| indexable text in `<body>` | none | the page |

`robots.txt` and `sitemap.xml` answer 200 only because the SPA catch-all serves
`index.html` for every unknown path. To a crawler that is a malformed robots
file, which is worse than a missing one.

## Shape

Decided with Duc, 2026-10-15:

```
/        the landing page   <- indexed, shared, linked
/play    the game
/guide   the field guide    (unchanged)
```

The root has to be the landing page, because the root is what gets crawled and
what people paste. Putting the page anywhere else leaves the crawled URL an
empty canvas and fixes nothing.

Nothing server-side pins the game to `/`: every CORS rule in `api/` and
`server/` is `allowedOriginPatterns("*")`.

## Not JavaScript

The page is HTML and CSS, no script tag.

`ui/theme.ts` publishes the palette to CSS custom properties at boot, which is
how `ui.css` and `guide.css` stay in step with the canvas. The landing page
cannot use it: `theme.ts` imports Phaser, so reading the palette that way would
put the whole engine on a page whose entire job is to paint fast and be read by
a crawler that does not run scripts.

So `landing.css` declares the handful of tokens it needs as literal values, and
a unit test asserts they equal `theme.ts`'s. One palette, still enforced,
without the import.

*(Checked, because `guide/main.tsx` imports `publishPalette` from `ui/theme`
and `ui/theme` imports Phaser: the guide bundle is 33 kB, so rollup drops it.
Phaser survives there only as a type. The landing page still takes no script
at all, which no amount of tree-shaking would have given it.)*

## Phases

**1 — move the game.** `index.html` becomes `play.html`; `vite.config.ts` gains
it as an input. Cloudflare Pages serves `play.html` at `/play`. Risk: low.
Verify: the game still boots, e2e green with its paths updated.

**2 — the page.** A new `index.html` plus `public/landing.css`. Real prose, not
pictures of prose: what the game is, how a match goes, the roster, a link to the
guide, the fan-project notice on the page rather than only in a meta tag. Guest
play exists (`ui/profile.ts:28`) so "no sign-up to try" is honest to say.
Risk: low.

**3 — the metadata.** Description, `og:`, `twitter:`, canonical on all three
pages. Real `public/robots.txt` and `public/sitemap.xml`. Risk: low.

**4 — the picture.** A 1200x630 `og.png` cut from a Playwright screenshot of a
real match. There are no screenshots of this game anywhere in the repo today.
Risk: low, but it is the only phase that needs the dev server running.

## Tests

- e2e: `/` renders an `h1` and links to both `/play` and `/guide`; `/play`
  still boots Phaser and reaches the menu.
- unit: every page carries description, canonical and the `og:` set.
- unit: `robots.txt` and `sitemap.xml` exist, parse, and name the live origin.
- unit: `landing.css` tokens equal `theme.ts`'s palette.

## Success

- [ ] `/` is a readable page with no JavaScript
- [ ] `/play` is the game, unchanged
- [ ] a shared link shows a title, a description and a picture
- [ ] `robots.txt` and `sitemap.xml` are real files
- [ ] the fan-project notice is visible on the page
- [ ] submitted in Google Search Console (Duc — needs the account)
