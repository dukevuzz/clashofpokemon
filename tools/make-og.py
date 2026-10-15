"""
The 1200x630 card a pasted link turns into.

Composed rather than screenshotted: the board is portrait 620x1080 and the
card is wide, so a crop of the game is either a sliver of it or a lot of
empty ground. The board sits on the right at its own aspect, and the left
says what the thing is -- which is the half a person actually reads in a
chat window.

    python3 tools/make-og.py

Reads client/public/shot-match.png, writes client/public/og.png.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "client" / "public"
FONT = PUBLIC / "fonts" / "PokemonClassic.ttf"

W, H = 1200, 630

# theme.ts. Kept in step by tests/site.test.ts for the CSS; these three are
# written here because a PNG cannot read a custom property.
BG = (0x4a, 0x55, 0x68)
EDGE = (0x14, 0x19, 0x26)
TEXT = (0xff, 0xff, 0xff)
DIM = (0xc3, 0xcd, 0xdf)
GOLD = (0xff, 0xc1, 0x07)

PAD = 56


def pixel(size):
    return ImageFont.truetype(str(FONT), size)


def main():
    shot = Image.open(PUBLIC / "shot-match.png").convert("RGB")

    card = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(card)

    # The board, full height, bled off the right edge so it reads as a window
    # into the game rather than a thumbnail pasted onto a slide.
    board_h = H - PAD
    board_w = round(shot.width * board_h / shot.height)
    board = shot.resize((board_w, board_h), Image.LANCZOS)
    bx = W - board_w - PAD
    by = (H - board_h) // 2
    draw.rectangle([bx - 4, by - 4, bx + board_w + 3, by + board_h + 3], fill=EDGE)
    card.paste(board, (bx, by))

    # Left column, to the board's edge.
    col = bx - PAD * 2
    x = PAD

    draw.text((x, 150), "Clash of", font=pixel(46), fill=TEXT)
    draw.text((x, 210), "Pokémon", font=pixel(46), fill=GOLD)

    body = pixel(17)
    lines = [
        "A lane battler played",
        "with Pokémon.",
        "",
        "Two players, three minutes,",
        "two bridges.",
    ]
    y = 300
    for line in lines:
        draw.text((x, y), line, font=body, fill=DIM)
        y += 30

    draw.text((x, 470), "clashofpokemon.online",
              font=pixel(15), fill=TEXT)
    # A hyphen, not a middot. PokemonClassic has no U+00B7 and draws the
    # missing-glyph box for it -- and for the bullet, the em dash and the
    # solidus. Checked rather than assumed: a real glyph has a tight bbox,
    # tofu fills the em square exactly.
    draw.text((x, 500), "free - no download", font=pixel(13), fill=DIM)

    assert col > 0, "left column collapsed"
    card.save(PUBLIC / "og.png", optimize=True)
    print(f"og.png {W}x{H}  {(PUBLIC / 'og.png').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
