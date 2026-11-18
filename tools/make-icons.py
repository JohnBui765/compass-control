"""Generate the app icons (needs Pillow): python3 tools/make-icons.py
A slate instrument bezel with the dial: 16 ticks, red dot at 9 o'clock, blue needle."""
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')


def icon(size, maskable=False):
    S = size * 4  # draw large, downsample for anti-aliasing
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, S, S], fill=(78, 87, 101, 255))
        scale = 0.70  # keep the dial inside the 80 % safe zone
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.17), fill=(86, 95, 110, 255), outline=(42, 47, 55, 255), width=max(2, S // 96))
        for fx, fy in [(0.11, 0.11), (0.89, 0.11), (0.11, 0.89), (0.89, 0.89)]:
            x, y, r = fx * S, fy * S, S * 0.035
            d.ellipse([x - r * 1.3, y - r * 1.3, x + r * 1.3, y + r * 1.3], fill=(37, 41, 48, 255))
            d.ellipse([x - r, y - r, x + r, y + r], fill=(206, 210, 216, 255))
        scale = 0.86
    cx = cy = S / 2
    R = S * 0.5 * scale * 0.86
    d.ellipse([cx - R * 1.1, cy - R * 1.1, cx + R * 1.1, cy + R * 1.1], fill=(27, 30, 35, 255))
    d.ellipse([cx - R * 1.045, cy - R * 1.045, cx + R * 1.045, cy + R * 1.045], outline=(150, 160, 172, 255), width=max(2, int(R * 0.035)))
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(12, 13, 15, 255))
    d.chord([cx - R, cy - R, cx + R, cy + R], 8, 172, fill=(44, 47, 52, 255))  # glass reflection, lower half
    for i in range(16):
        deg = i * 22.5
        if deg == 270:
            continue
        major = deg % 90 == 0
        a = math.radians(deg - 90)
        r0, r1 = (0.6 if major else 0.69) * R, 0.84 * R
        d.line([cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * r1, cy + math.sin(a) * r1], fill=(240, 240, 240, 255), width=max(2, int(R * (0.075 if major else 0.045))))
    d.line([cx, cy, cx - 0.84 * R, cy], fill=(42, 69, 216, 255), width=max(3, int(R * 0.08)))
    rr = 0.14 * R
    x = cx - 0.84 * R
    d.ellipse([x - rr, cy - rr, x + rr, cy + rr], fill=(228, 40, 30, 255))
    d.ellipse([x - rr * 0.45, cy - rr * 0.6, x - rr * 0.05, cy - rr * 0.2], fill=(255, 170, 160, 255))
    hub = R * 0.06
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(42, 69, 216, 255))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    icon(192).save(os.path.join(OUT, 'icon-192.png'))
    icon(512).save(os.path.join(OUT, 'icon-512.png'))
    icon(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
    print('icons written to', os.path.normpath(OUT))
