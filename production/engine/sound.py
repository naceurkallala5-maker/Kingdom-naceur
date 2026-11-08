"""Sound design for Kingdom Nasser videos: effects and natural beds, no music,
no bells, no instruments. Everything is synthesised here from noise and
simple tones, so it is new, varied and free of rights.

Usage: python3 sound.py <spec.json> <out.wav>
spec: {
  "total": 38.2,
  "events": [{"t": 1.2, "kind": "drop", "gain": 1.0}, ...],
  "bed": {"kind": "forest", "gain": 0.45},
  "duck": [[start, end], ...]          # bed is lowered while a recitation plays
}
Event kinds: drop, drops, whoosh, swell, rustle, bird, boom, sparkle, breath
Bed kinds: forest, garden, rain, wind, water, night, none
"""
import json
import sys
import wave

import numpy as np

from ambience import RATE, rain, water, night, wind, shaped_noise

rng = np.random.default_rng(786)


def t_axis(sec):
    return np.arange(int(RATE * sec)) / RATE


# ---------------- effects ----------------

def drop(gain=1.0, pitch=None):
    """A water drop: a short sine whose pitch falls quickly."""
    sec = 0.35
    t = t_axis(sec)
    f0 = pitch or rng.uniform(900, 1500)
    freq = f0 * (1 + 1.8 * np.exp(-t * 60))
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return gain * 0.55 * np.sin(phase) * np.exp(-t * 14) * np.minimum(1, t / 0.002)


def drops(gain=1.0):
    """Three drops at slightly different pitches, like water on stone."""
    out = np.zeros(int(RATE * 0.9))
    for k, f in enumerate(rng.uniform(800, 1600, 3)):
        d = drop(gain * (0.9 - 0.2 * k), f)
        s = int(RATE * (0.12 * k + rng.uniform(0, 0.05)))
        out[s:s + len(d)] += d
    return out


def whoosh(gain=1.0, sec=0.9):
    """Air moving past: band-passed noise with a rising then falling centre."""
    n = int(RATE * sec)
    t = np.arange(n) / RATE
    noise = rng.standard_normal(n)
    # sweep by mixing two shaped bands with crossfading envelopes
    low = shaped_noise(n, lambda f: np.exp(-((f - 500) / 400) ** 2))
    high = shaped_noise(n, lambda f: np.exp(-((f - 2500) / 1500) ** 2))
    k = t / sec
    env = np.sin(np.pi * k) ** 1.5
    return gain * 0.5 * env * ((1 - k) * low + k * high) + 0.02 * noise * env


def swell(gain=1.0, sec=1.6):
    """A soft rising wash before an important moment."""
    n = int(RATE * sec)
    k = np.arange(n) / n
    air = shaped_noise(n, lambda f: np.exp(-f / 1800) / np.sqrt(f))
    return gain * 0.45 * air * k ** 2.2


def breath(gain=1.0):
    return swell(gain * 0.8, 0.7)[::-1] * 0.8


def rustle(gain=1.0, sec=0.8):
    """Leaves moving: many tiny clicks of filtered noise."""
    n = int(RATE * sec)
    out = np.zeros(n)
    for p in rng.integers(0, n - 300, int(sec * 160)):
        out[p:p + 300] += rng.uniform(0.1, 1) * rng.standard_normal(300) * np.exp(-np.arange(300) / 40)
    out = out / (np.max(np.abs(out)) or 1)
    shape = np.sin(np.pi * np.arange(n) / n)
    return gain * 0.35 * out * shape


def bird(gain=1.0):
    """A small songbird phrase: two to four quick frequency-modulated chirps."""
    out = np.zeros(int(RATE * 0.9))
    pos = 0
    base = rng.uniform(2800, 4200)
    for _ in range(rng.integers(2, 5)):
        sec = rng.uniform(0.05, 0.11)
        t = t_axis(sec)
        f = base * (1 + 0.35 * np.sin(2 * np.pi * rng.uniform(25, 45) * t)) * (1 + rng.uniform(-0.3, 0.3) * t / sec)
        chirp = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.sin(np.pi * t / sec) ** 2
        if pos + len(chirp) < len(out):
            out[pos:pos + len(chirp)] += chirp
        pos += len(chirp) + int(RATE * rng.uniform(0.02, 0.08))
    return gain * 0.18 * out


def boom(gain=1.0):
    """A deep cinematic hit: a falling low tone with a soft noise body."""
    sec = 2.2
    t = t_axis(sec)
    freq = 38 + 50 * np.exp(-t * 9)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / RATE) * np.exp(-t * 2.2)
    body = shaped_noise(len(t), lambda f: np.exp(-f / 220)) * np.exp(-t * 5)
    return gain * (0.75 * tone + 0.35 * body) * np.minimum(1, t / 0.004)


def sparkle(gain=1.0):
    """A bright airy shimmer made of filtered noise grains (not a bell)."""
    n = int(RATE * 1.1)
    out = np.zeros(n)
    for p in np.sort(rng.integers(0, int(RATE * 0.5), 18)):
        g = shaped_noise(1200, lambda f: np.exp(-((f - rng.uniform(6000, 9000)) / 1500) ** 2))
        out[p:p + 1200] += g * np.exp(-np.arange(1200) / 250) * rng.uniform(0.3, 1)
    out = out / (np.max(np.abs(out)) or 1)
    return gain * 0.22 * out * np.exp(-np.arange(n) / RATE * 2)


EFFECTS = {"drop": drop, "drops": drops, "whoosh": whoosh, "swell": swell, "breath": breath,
           "rustle": rustle, "bird": bird, "boom": boom, "sparkle": sparkle}


# ---------------- natural beds ----------------

def forest(n):
    bed = 0.5 * wind(n) * 0.5
    # leaves now and then, birds scattered
    k = 0
    while k < n - RATE:
        r = rustle(0.6, rng.uniform(0.5, 1.4))
        if k + len(r) < n:
            bed[k:k + len(r)] += r
        k += int(RATE * rng.uniform(1.0, 2.6))
    k = int(RATE * 0.5)
    while k < n - RATE:
        b = bird(rng.uniform(0.5, 1.0))
        bed[k:k + len(b)] += b
        k += int(RATE * rng.uniform(1.2, 3.5))
    return bed


def garden(n):
    bed = 0.6 * water(n)
    k = int(RATE * 0.8)
    while k < n - RATE:
        b = bird(rng.uniform(0.4, 0.9))
        bed[k:k + len(b)] += b
        k += int(RATE * rng.uniform(1.5, 4.0))
    return bed


def rain_wind(n):
    return 0.7 * rain(n) + 0.4 * wind(n)


BEDS = {"forest": forest, "garden": garden, "rain": rain_wind, "wind": wind, "water": water, "night": night}


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    n = int(RATE * (spec["total"] + 0.5))
    mix = np.zeros(n)
    bed_spec = spec.get("bed") or {}
    if bed_spec.get("kind", "none") != "none":
        bed = BEDS[bed_spec["kind"]](n)
        bed = bed / (np.max(np.abs(bed)) or 1) * bed_spec.get("gain", 0.4)
        env = np.ones(n)
        for a, b in spec.get("duck", []):
            ia, ib = int(a * RATE), min(n, int(b * RATE))
            ramp = int(0.6 * RATE)
            env[ia:ib] = 0.35
            env[max(0, ia - ramp):ia] = np.minimum(env[max(0, ia - ramp):ia], np.linspace(1, 0.35, ia - max(0, ia - ramp)))
            env[ib:min(n, ib + ramp)] = np.minimum(env[ib:min(n, ib + ramp)], np.linspace(0.35, 1, min(n, ib + ramp) - ib))
        fade = int(1.5 * RATE)
        env[:fade] *= np.linspace(0, 1, fade)
        env[-fade:] *= np.linspace(1, 0, fade)
        mix += bed * env
    for e in spec.get("events", []):
        fx = EFFECTS[e["kind"]](e.get("gain", 1.0))
        s = max(0, int(e["t"] * RATE))
        end = min(n, s + len(fx))
        mix[s:end] += fx[: end - s]
    peak = np.max(np.abs(mix)) or 1
    if peak > 0.9:
        mix *= 0.9 / peak
    with wave.open(sys.argv[2], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((mix * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    main()
