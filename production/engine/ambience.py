"""Natural background soundscapes, synthesised from noise (no music, no recordings).

Every texture is generated mathematically with seeded noise and spectral
shaping, so it is new each time it is designed, has no copyright owner and
contains no melody.

Usage: python3 ambience.py <kind> <seconds> <out.wav>
kinds: wind, rain, water, night
"""
import sys
import wave

import numpy as np

RATE = 44100
rng = np.random.default_rng(1447)


def shaped_noise(n, curve):
    """White noise shaped in the frequency domain by curve(freqs)."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    out = np.fft.irfft(spec * curve(np.maximum(f, 1.0)), n)
    return out / (np.max(np.abs(out)) or 1)


def lfo(n, rate, depth, phase=0.0):
    t = np.arange(n) / RATE
    return 1 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + phase))


def slow_random(n, points, smooth=True):
    """A slowly wandering envelope between 0 and 1."""
    knots = rng.random(points)
    x = np.linspace(0, points - 1, n)
    env = np.interp(x, np.arange(points), knots)
    return env


def wind(n):
    base = shaped_noise(n, lambda f: 1 / f ** 0.9 * np.exp(-f / 900))
    gust = 0.35 + 0.65 * slow_random(n, max(4, n // (RATE * 3)))
    whistle = shaped_noise(n, lambda f: np.exp(-((f - 650) / 180) ** 2)) * 0.25 * slow_random(n, max(4, n // (RATE * 5)))
    return 0.55 * base * gust + whistle


def rain(n):
    hiss = shaped_noise(n, lambda f: np.clip((f - 400) / 3000, 0, 1) * np.exp(-f / 9000))
    drops = np.zeros(n)
    count = int(n / RATE * 55)
    pos = rng.integers(0, n - 400, count)
    decay = np.exp(-np.arange(400) / 45)
    for p in pos:
        drops[p:p + 400] += rng.uniform(0.2, 1.0) * rng.standard_normal(400) * decay
    drops = drops / (np.max(np.abs(drops)) or 1)
    return 0.6 * hiss + 0.35 * drops


def water(n):
    flow = shaped_noise(n, lambda f: np.exp(-((np.log(f) - np.log(1200)) / 0.9) ** 2))
    burble = lfo(n, 3.1, 0.5) * lfo(n, 0.37, 0.4, 1.3) * lfo(n, 7.3, 0.25, 0.7)
    return 0.8 * flow * burble


def night(n):
    air = wind(n) * 0.35
    crickets = np.zeros(n)
    t = np.arange(int(RATE * 0.06)) / RATE
    chirp = np.sin(2 * np.pi * 4700 * t) * np.sin(np.pi * t / t[-1]) ** 2
    k = 0
    while k < n - RATE:
        burst_start = k
        for _ in range(rng.integers(2, 4)):
            if burst_start + len(chirp) < n:
                crickets[burst_start:burst_start + len(chirp)] += chirp * rng.uniform(0.5, 1.0)
            burst_start += int(RATE * 0.09)
        k += int(RATE * rng.uniform(0.6, 1.4))
    return air + 0.12 * crickets


KINDS = {"wind": wind, "rain": rain, "water": water, "night": night}


def main():
    kind, seconds, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    n = int(RATE * (seconds + 0.5))
    sig = KINDS[kind](n)
    fade = int(RATE * 1.5)
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    sig = sig * env
    sig = 0.5 * sig / (np.max(np.abs(sig)) or 1)
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((sig * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    main()
