#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сгенерировать звуковые подсказки PBX (custom/all-busy, after-hours, confirm-press-1)
через Yandex SpeechKit TTS и положить в Asterisk sounds (WAV 8kHz mono PCM).

  python tools/gen_pbx_prompts.py            # local (читает .env из проекта)
  python tools/gen_pbx_prompts.py --remote   # на проде: /var/lib/asterisk/sounds/custom

Ключи: YANDEX_SPEECHKIT_API_KEY, YANDEX_SPEECHKIT_FOLDER_ID (или YANDEX_FOLDER_ID).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import struct
import sys
import urllib.parse
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PROMPTS = {
    "all-busy": "Асгард приветствует, воин! Скоро мы вам ответим. Все операторы сейчас заняты, пожалуйста, оставайтесь на линии или перезвоните чуть позже.",
    "after-hours": "Асгард приветствует, воин! Врата закрыты. Сейчас нерабочее время. Оставьте весть после сигнала, и мы ответим, как откроются.",
    "confirm-press-1": "Нажмите один, чтобы принять звонок.",
    "invalid": "Неверный код. Попробуйте ещё раз.",
}


def load_env(path: Path) -> dict:
    env = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def tts(text: str, api_key: str, folder_id: str) -> bytes:
    params = urllib.parse.urlencode({
        "text": text,
        "lang": "ru-RU",
        "voice": "alena",
        "emotion": "neutral",
        "format": "lpcm",
        "sampleRateHertz": "8000",
        "folderId": folder_id,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
        data=params,
        headers={"Authorization": f"Api-Key {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def pcm_to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(pcm)
    return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true", help="use prod env + prod sounds dir")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    env_path = Path("/var/www/asgard-crm/.env") if args.remote else (ROOT / ".env")
    out_dir = Path(args.out or ("/var/lib/asterisk/sounds/custom" if args.remote else (ROOT / "ops/asterisk/sounds")))
    env = load_env(env_path)
    env.update({k: v for k, v in os.environ.items() if k.startswith("YANDEX_")})

    api_key = env.get("YANDEX_SPEECHKIT_API_KEY") or env.get("YANDEX_API_KEY") or ""
    folder = env.get("YANDEX_SPEECHKIT_FOLDER_ID") or env.get("YANDEX_FOLDER_ID") or ""
    if not api_key or not folder:
        print("FAIL: YANDEX_SPEECHKIT_API_KEY / folder не найдены", file=sys.stderr)
        return 2

    out_dir.mkdir(parents=True, exist_ok=True)
    ok = 0
    for name, text in PROMPTS.items():
        try:
            pcm = tts(text, api_key, folder)
            if len(pcm) < 400:
                raise RuntimeError(f"too short ({len(pcm)} bytes)")
            (out_dir / f"{name}.wav").write_bytes(pcm_to_wav(pcm))
            print(f"OK  {name}.wav  ({len(pcm)} bytes pcm)")
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"ERR {name}: {e}", file=sys.stderr)
    print(f"generated {ok}/{len(PROMPTS)} → {out_dir}")
    return 0 if ok == len(PROMPTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
