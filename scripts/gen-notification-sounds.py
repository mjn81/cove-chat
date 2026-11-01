"""Synthesises Cove's own call ring and whisper-request chime (no samples, no downloads).

    python scripts/gen-notification-sounds.py        (or: make sounds)

Writes 16-bit mono WAVs for both clients:
  client-web/public/call-ring.wav, whisper-request.wav
  client-android/app/src/main/res/raw/call_ring.wav, whisper_request.wav

The ring is a short phrase meant to be looped (the web client loops it, Android loops it through the notification's
insistent flag); the whisper chime is deliberately quiet and low, to match what a Whisper is.
"""
import math
import struct
import wave
from pathlib import Path

RATE = 22050
ROOT = Path(__file__).resolve().parent.parent

# Equal-tempered note frequencies (Hz).
NOTES = {"A4": 440.00, "E4": 329.63, "G4": 392.00, "B4": 493.88, "E5": 659.25, "G5": 783.99, "B5": 987.77, "D5": 587.33}


def tone(freq, seconds, volume=0.5, decay=6.0, harmonics=((1, 1.0), (2, 0.25), (3, 0.08))):
    """A plucked, bell-like note: a few harmonics under an exponential decay with a very short attack."""
    n = int(RATE * seconds)
    attack = int(RATE * 0.006)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-decay * t) * (min(1.0, i / attack) if attack else 1.0)
        s = sum(w * math.sin(2 * math.pi * freq * h * t) for h, w in harmonics)
        out.append(volume * env * s / sum(w for _, w in harmonics))
    return out


def silence(seconds):
    return [0.0] * int(RATE * seconds)


def mix_at(track, samples, start_seconds):
    """Adds samples into track at a time offset, growing the track if needed."""
    start = int(RATE * start_seconds)
    if len(track) < start + len(samples):
        track.extend([0.0] * (start + len(samples) - len(track)))
    for i, v in enumerate(samples):
        track[start + i] += v


def write_wav(path, samples):
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = max(1e-9, max(abs(v) for v in samples))
    scale = min(1.0, 0.92 / peak)  # never clip; quiet sounds stay quiet
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v * scale)) * 32767)) for v in samples))


def call_ring():
    """Two rising three-note figures, a pause, then silence so the loop breathes: about 3.2 s."""
    track = []
    figure = [("E5", 0.00), ("G5", 0.16), ("B5", 0.32), ("G5", 0.62), ("B5", 0.78), ("E5", 0.94)]
    for name, at in figure:
        mix_at(track, tone(NOTES[name], 0.55, volume=0.55, decay=5.0), at)
    # A second, slightly brighter pass so it reads as a ring and not a single notification.
    for name, at in figure:
        mix_at(track, tone(NOTES[name], 0.55, volume=0.55, decay=5.0), at + 1.35)
    track.extend(silence(3.2 - len(track) / RATE))
    return track


def whisper_request():
    """Two soft, low notes, the second a fourth below the first: hushed, about 1.1 s."""
    track = []
    mix_at(track, tone(NOTES["A4"], 0.9, volume=0.32, decay=4.2, harmonics=((1, 1.0), (2, 0.12))), 0.00)
    mix_at(track, tone(NOTES["E4"], 0.9, volume=0.30, decay=4.0, harmonics=((1, 1.0), (2, 0.12))), 0.22)
    return track


if __name__ == "__main__":
    ring, whisper = call_ring(), whisper_request()
    for target, samples in (
        (ROOT / "client-web/public/call-ring.wav", ring),
        (ROOT / "client-web/public/whisper-request.wav", whisper),
        (ROOT / "client-android/app/src/main/res/raw/call_ring.wav", ring),
        (ROOT / "client-android/app/src/main/res/raw/whisper_request.wav", whisper),
    ):
        write_wav(target, samples)
        print(f"{target.relative_to(ROOT)}: {len(samples) / RATE:.1f}s, {target.stat().st_size // 1024} KB")
