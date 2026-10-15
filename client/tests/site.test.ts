/**
 * What a crawler and a link preview see.
 *
 * None of this is reachable from the running game, which is exactly why it
 * rotted: the site shipped for months with no description, no `og:` tags and
 * no robots file, and nothing anywhere said so. These assertions are the only
 * thing that will notice when a page is added without them again.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { C, hex } from "../src/ui/theme";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** The live origin, which several files have to agree about. */
const ORIGIN = "https://www.clashofpokemon.online";

const PAGES = [
  { file: "index.html", path: "/" },
  { file: "play.html", path: "/play" },
  { file: "guide.html", path: "/guide" },
];

const meta = (html: string, name: string): string | undefined =>
  html.match(
    new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
  )?.[1]
  ?? html.match(
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i"),
  )?.[1];

describe("every page", () => {
  for (const page of PAGES) {
    describe(page.file, () => {
      const html = () => read(page.file);

      it("has a title", () => {
        expect(html()).toMatch(/<title>[^<]+<\/title>/);
      });

      it("has a description a search result can quote", () => {
        const d = meta(html(), "description");
        expect(d, "no <meta name=description>").toBeTruthy();
        // Long enough to say something, short enough not to be truncated.
        expect(d!.length).toBeGreaterThan(50);
        expect(d!.length).toBeLessThan(200);
      });

      it("says which URL it is", () => {
        expect(html()).toMatch(
          new RegExp(`<link[^>]*rel=["']canonical["'][^>]*href=["']${ORIGIN}${page.path === "/" ? "/" : page.path}["']`),
        );
      });

      it("previews as a card when it is shared", () => {
        const h = html();
        for (const tag of ["og:title", "og:description", "og:image", "og:url", "twitter:card"]) {
          expect(meta(h, tag), `missing ${tag}`).toBeTruthy();
        }
        expect(meta(h, "og:image")).toMatch(/^https:\/\//);
      });

      it("still says whose Pokémon these are", () => {
        expect(meta(html(), "copyright")).toMatch(/Nintendo/);
      });
    });
  }
});

describe("the files a crawler asks for first", () => {
  it("ships a real robots.txt, not the app shell", () => {
    const p = "public/robots.txt";
    expect(existsSync(resolve(root, p)), `${p} missing`).toBe(true);
    const txt = read(p);
    expect(txt).not.toMatch(/<html/i);
    expect(txt).toMatch(/^User-agent:/mi);
    expect(txt).toMatch(new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "mi"));
  });

  it("ships a sitemap naming every page", () => {
    const p = "public/sitemap.xml";
    expect(existsSync(resolve(root, p)), `${p} missing`).toBe(true);
    const xml = read(p);
    expect(xml).toMatch(/^<\?xml/);
    for (const page of PAGES) {
      const url = page.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${page.path}`;
      expect(xml, `sitemap does not list ${url}`).toContain(`<loc>${url}</loc>`);
    }
  });

  it("does not forbid the crawlers it is trying to attract", () => {
    expect(read("public/robots.txt")).not.toMatch(/^Disallow:\s*\/\s*$/mi);
  });
});

describe("the landing page itself", () => {
  const html = () => read("index.html");

  it("needs no JavaScript to say what the game is", () => {
    // A <script> here would mean the page a crawler reads is not the page it
    // renders -- and the whole point of this page is to be read without one.
    expect(html()).not.toMatch(/<script/i);
  });

  it("has prose, not a canvas", () => {
    const h = html();
    expect(h).toMatch(/<h1[^>]*>/);
    expect(h).not.toMatch(/id=["']game["']/);
    // Enough words to be worth indexing.
    const text = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text.split(" ").length).toBeGreaterThan(150);
  });

  it("sends a reader to the game and to the guide", () => {
    const h = html();
    expect(h).toMatch(/href=["']\.?\/?play(?:\.html)?["']/);
    expect(h).toMatch(/href=["']\.?\/?guide(?:\.html)?["']/);
  });

  it("still proves to Google that we own it", () => {
    // Not one-time setup: Google re-checks, and un-verifies the property if
    // the tag goes away. Removing it silently costs the site its Search
    // Console data and its sitemap submission.
    expect(meta(html(), "google-site-verification"),
      "the Search Console verification tag is gone").toBeTruthy();
  });

  it("carries the fan-project notice where a person can read it", () => {
    const text = html().replace(/<[^>]+>/g, " ");
    expect(text).toMatch(/Nintendo/);
    expect(text).toMatch(/not affiliated/i);
  });
});

describe("one palette", () => {
  /**
   * `landing.css` cannot import `theme.ts` -- it pulls Phaser in. So it writes
   * the hexes out, and this is what stops the two drifting apart.
   */
  it("spells the shared tokens exactly as theme.ts does", () => {
    const css = read("public/landing.css");
    const block = css.match(/:root\s*\{([^}]*)\}/)?.[1];
    expect(block, "landing.css has no :root block").toBeTruthy();

    const declared = [...block!.matchAll(/--([a-zA-Z]+)\s*:\s*(#[0-9a-fA-F]{6})/g)];
    expect(declared.length, "no tokens declared").toBeGreaterThan(3);

    for (const [, name, value] of declared) {
      const known = (C as Record<string, number | string>)[name];
      expect(known, `--${name} is not a theme.ts colour`).toBeDefined();
      expect(value.toLowerCase(), `--${name} has drifted from theme.ts`)
        .toBe(hex(known as number));
    }
  });
});
