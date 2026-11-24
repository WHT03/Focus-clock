# -*- coding: utf-8 -*-
"""生成达标提醒音 goal-ding.wav：两音阶上行 chime（880Hz -> 1174.66Hz）。"""
import math
import os
import struct
import wave

SR = 44100  # 采样率
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "audio", "goal-ding.wav")


def tone(freq, dur, fade=0.03):
    """生成一段带淡入淡出的正弦波样本列表。"""
    n = int(SR * dur)
    samples = []
    for i in range(n):
        env = 1.0
        t = i / SR
        if t < fade:
            env = t / fade
        elif t > dur - fade:
            env = max(0.0, (dur - t) / fade)
        # 轻微谐波让声音更"叮"一些
        v = math.sin(2 * math.pi * freq * t) * 0.8 + math.sin(2 * math.pi * freq * 2 * t) * 0.2
        samples.append(v * env * 0.6)
    return samples


def main():
    samples = []
    # 第一声 880Hz 0.22s，间隔 0.06s，第二声 1174.66Hz 0.32s（更长更亮）
    samples += tone(880.0, 0.22)
    samples += [0.0] * int(SR * 0.06)
    samples += tone(1174.66, 0.32)
    d = os.path.dirname(OUT)
    if not os.path.isdir(d):
        os.makedirs(d)
    with wave.open(OUT, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples)
        w.writeframes(frames)
    print("written:", os.path.abspath(OUT), "duration ~%.2fs" % (len(samples) / SR))


if __name__ == "__main__":
    main()
