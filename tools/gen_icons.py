# -*- coding: utf-8 -*-
"""生成 tabBar 图标（纯标准库，无第三方依赖）。

输出到 assets/icons/：timer / heatmap / stats 各两态（普通、选中）。
"""
import math
import struct
import zlib
import os

TARGET = 81      # 最终尺寸
SS = 3           # 超采样倍数
N = TARGET * SS  # 采样网格

NORMAL = (154, 160, 166)   # #9aa0a6
ACTIVE = (79, 70, 229)     # #4f46e5


def seg_dist(px, py, ax, ay, bx, by):
    """点到线段距离"""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = (wx * vx + wy * vy) / (vx * vx + vy * vy)
    t = max(0.0, min(1.0, t))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)


def rrect(px, py, x0, y0, w, h, r):
    """圆角矩形内部判定"""
    x1, y1 = x0 + w, y0 + h
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    if (x0 + r <= px <= x1 - r) or (y0 + r <= py <= y1 - r):
        return True
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        if math.hypot(px - cx, py - cy) <= r:
            return True
    return False


def shape_timer(px, py):
    C = TARGET / 2.0
    # 外圈
    d = math.hypot(px - C, py - C)
    if abs(d - 25.0) <= 4.5:
        return True
    # 顶部按钮
    if rrect(px, py, C - 4.0, 4.0, 8.0, 9.0, 3.0):
        return True
    # 指针：向上 12 点 + 向右 3 点 + 中心点
    if seg_dist(px, py, C, C, C, C - 15.0) <= 3.0:
        return True
    if seg_dist(px, py, C, C, C + 13.0, C) <= 3.0:
        return True
    return False


def shape_heatmap(px, py):
    s, gap = 15.0, 6.25
    total = 3 * s + 2 * gap
    start = (TARGET - total) / 2.0
    for i in range(3):
        for j in range(3):
            x0 = start + i * (s + gap)
            y0 = start + j * (s + gap)
            if rrect(px, py, x0, y0, s, s, 4.0):
                return True
    return False


def shape_stats(px, py):
    baseline = 67.0
    bars = [(11.0, 26.0), (33.5, 42.0), (56.0, 58.0)]
    for x0, h in bars:
        if rrect(px, py, x0, baseline - h, 14.0, h, 4.0):
            return True
    return False


def write_png(path, rgb):
    alpha = [[0.0] * TARGET for _ in range(TARGET)]
    for y in range(TARGET):
        for x in range(TARGET):
            acc = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = (x * SS + sx) + 0.5
                    px = px / SS
                    py = ((y * SS + sy) + 0.5) / SS
                    if shape(px, py):
                        acc += 1
            alpha[y][x] = acc / (SS * SS)

    raw = b""
    for y in range(TARGET):
        row = b"\x00"
        for x in range(TARGET):
            a = alpha[y][x]
            row += struct.pack("4B", rgb[0], rgb[1], rgb[2], int(round(a * 255)))
        raw += row

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", TARGET, TARGET, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


out_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "icons"))
os.makedirs(out_dir, exist_ok=True)

jobs = [
    ("timer", shape_timer),
    ("heatmap", shape_heatmap),
    ("stats", shape_stats),
]

for name, shape in jobs:
    for suffix, rgb in (("", NORMAL), ("-active", ACTIVE)):
        globals()["shape"] = shape
        write_png(os.path.join(out_dir, name + suffix + ".png"), rgb)
        print("written", name + suffix + ".png")
