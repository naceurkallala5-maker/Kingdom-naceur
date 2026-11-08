"""Synthesises the soundtrack: soft bell chimes at each text change. No music.

The chime is generated mathematically (additive bell partials with exponential
decay), so there are no third-party sounds and no licensing questions.

Usage: python3 chimes.py <cues.json> <total_seconds> <out.wav>
cues.json: [{"t": 0.25, "kind": "chime" | "soft"}, ...]
"""
import json
import sys
import wave

import numpy as np

RATE = 44100


def bell(base, seconds, gain):
    t = np.arange(int(RATE * seconds)) / RATE
    partials = [(1.0, 1.0, 1.6), (2.0, 0.45, 2.4), (2.76, 0.30, 3.2), (5.40, 0.12, 5.0), (8.93, 0.05, 7.0)]
    sig = np.zeros_like(t)
    for ratio, amp, decay in partials:
        sig += amp * np.sin(2 * np.pi * base * ratio * t) * np.exp(-decay * t)
    attack = np.minimum(1.0, t / 0.004)
    return gain * sig * attack / sum(p[1] for p in partials)


def main():
    cues = json.load(open(sys.argv[1], encoding="utf-8"))
    total = float(sys.argv[2])
    track = np.zeros(int(RATE * (total + 0.5)))
    tones = {
        "chime": bell(1046.5, 2.2, 0.32),   # C6, clear
        "soft": bell(784.0, 2.8, 0.20),     # G5, gentler, before verses
    }
    for c in cues:
        tone = tones.get(c.get("kind", "chime"), tones["chime"])
        start = int(RATE * float(c["t"]))
        end = min(len(track), start + len(tone))
        track[start:end] += tone[: end - start]
    peak = np.max(np.abs(track)) or 1.0
    if peak > 0.9:
        track *= 0.9 / peak
    pcm = (track * 32767).astype("<i2")
    with wave.open(sys.argv[3], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main()
