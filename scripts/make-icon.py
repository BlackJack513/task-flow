"""Generate the TaskFlow app icon (build/icon.ico and build/icon.png)."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCALE = 2
SIZE = 1024
S = SIZE * SCALE
MARGIN = 64 * SCALE
RADIUS = 214 * SCALE

PAPER = (246, 242, 233, 255)
INK_TOP = (45, 62, 76, 255)
INK_BOTTOM = (27, 40, 51, 255)
AMBER = (211, 159, 86, 255)
BLUE = (122, 158, 189, 255)
GREEN = (122, 172, 143, 255)
CARD = (255, 252, 244, 255)


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_icon(light: bool = False) -> Image.Image:
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    tile_mask = Image.new("L", (S, S), 0)
    mask_draw = ImageDraw.Draw(tile_mask)
    mask_draw.rounded_rectangle(
        (MARGIN, MARGIN, S - MARGIN, S - MARGIN),
        radius=RADIUS,
        fill=255,
    )

    if light:
        background = Image.new("RGBA", (S, S), PAPER)
        border = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        border_draw = ImageDraw.Draw(border)
        border_draw.rounded_rectangle(
            (MARGIN, MARGIN, S - MARGIN, S - MARGIN),
            radius=RADIUS,
            outline=(211, 204, 190, 255),
            width=7 * SCALE,
        )
        canvas.paste(background, (0, 0), tile_mask)
        left, top = 172, 226
        height = 572
    else:
        gradient = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        gradient_draw = ImageDraw.Draw(gradient)
        for y in range(S):
            t = y / max(1, S - 1)
            color = tuple(
                round(INK_TOP[i] * (1 - t) + INK_BOTTOM[i] * t) for i in range(3)
            ) + (255,)
            gradient_draw.line((0, y, S, y), fill=color)
        canvas.paste(gradient, (0, 0), tile_mask)

        edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        edge_draw = ImageDraw.Draw(edge)
        edge_draw.rounded_rectangle(
            (MARGIN, MARGIN, S - MARGIN, S - MARGIN),
            radius=RADIUS,
            outline=(255, 255, 255, 18),
            width=3 * SCALE,
        )
        canvas.alpha_composite(edge)
        left, top = 172, 226
        height = 572

    draw = ImageDraw.Draw(canvas)
    start_x = left * SCALE
    top_y = top * SCALE
    column_w = 184 * SCALE
    gap = 64 * SCALE
    column_h = height * SCALE
    column_radius = 44 * SCALE

    colors = (AMBER, BLUE, GREEN)
    for index, color in enumerate(colors):
        x = start_x + index * (column_w + gap)
        rounded(draw, (x, top_y, x + column_w, top_y + column_h), column_radius, color)

        card_x = x + 24 * SCALE
        card_w = 136 * SCALE
        card_h = 52 * SCALE
        for card_index in range(3):
            card_y = top_y + (68 + card_index * 76) * SCALE
            opacity = 255 if card_index < 2 else 210
            rounded(
                draw,
                (card_x, card_y, card_x + card_w, card_y + card_h),
                15 * SCALE,
                CARD[:3] + (opacity,),
            )

    if light:
        canvas.alpha_composite(border)

    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    build = root / "build"
    build.mkdir(exist_ok=True)

    variant = "light" if "--light" in sys.argv else "dark"
    image = make_icon(light=variant == "light")
    image.save(build / f"icon-{variant}.png")
    print(f"wrote build/icon-{variant}.png")

    if variant == "dark":
        image.save(build / "icon.png")
        image.save(
            build / "icon.ico",
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
        print("wrote build/icon.png and build/icon.ico")


if __name__ == "__main__":
    main()
