from PIL import Image, ImageDraw
import math
import os
import sys

S = 1024
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
os.makedirs(OUT_DIR, exist_ok=True)

# ---------- 背景渐变 ----------
grad = Image.new("RGB", (S, S))
px = grad.load()
c1 = (0x33, 0x55, 0xD1)   # 深一点的靛蓝
c2 = (0x6D, 0x8B, 0xFF)   # 亮蓝
for y in range(S):
    for x in range(0, S, 4):
        t = (x / S * 0.55 + y / S * 0.45)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        for k in range(4):
            if x + k < S:
                px[x + k, y] = (r, g, b)

# 圆角遮罩
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img, "RGBA")

# ---------- 书页 ----------
WHITE = (255, 255, 255, 255)
SOFT = (238, 243, 255, 255)

# 左页（略向左下倾斜）
left = [
    (S * 0.195, S * 0.375),
    (S * 0.485, S * 0.315),
    (S * 0.485, S * 0.735),
    (S * 0.195, S * 0.700),
]
right = [
    (S * 0.805, S * 0.375),
    (S * 0.515, S * 0.315),
    (S * 0.515, S * 0.735),
    (S * 0.805, S * 0.700),
]
d.polygon(left, fill=WHITE)
d.polygon(right, fill=SOFT)

# 书脊
d.polygon([(S * 0.485, S * 0.315), (S * 0.515, S * 0.315), (S * 0.515, S * 0.735), (S * 0.485, S * 0.735)],
          fill=(0x2B, 0x46, 0xB8, 255))

# 页面文字线
line_color = (0x33, 0x55, 0xD1, 110)
for i in range(4):
    y = S * (0.405 + i * 0.078)
    d.line([(S * 0.235, y - 0.006 * S), (S * 0.445, y + 0.004 * S)], fill=line_color, width=int(S * 0.015))
    d.line([(S * 0.555, y + 0.004 * S), (S * 0.765, y - 0.006 * S)], fill=line_color, width=int(S * 0.015))

# ---------- 星芒 ----------
def spark(draw, cx, cy, r, color):
    pts = []
    for i in range(8):
        ang = math.pi / 4 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.30
        pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
    draw.polygon(pts, fill=color)

spark(d, S * 0.775, S * 0.235, S * 0.075, (255, 214, 130, 255))
spark(d, S * 0.868, S * 0.150, S * 0.038, (255, 236, 190, 235))

# ---------- 导出 ----------
big = img.resize((256, 256), Image.LANCZOS)
big.save(os.path.join(OUT_DIR, "icon.png"))
big.save(
    os.path.join(OUT_DIR, "icon.ico"),
    format="ICO",
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print("icon written to", OUT_DIR)
