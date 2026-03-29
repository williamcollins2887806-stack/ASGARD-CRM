#!/usr/bin/env python3
"""
ASGARD Silero TTS Microservice
Синтез речи через Silero v5_ru, выдаёт slin16 PCM 8kHz для Asterisk AudioSocket.
Запуск: python3 scripts/silero-tts-service.py
Порт: 8765 (только localhost)
"""

import os
import io
import sys
import re
import time
import struct
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

# ── Словарь ударений ─────────────────────────────────────────────
# Загружаем из stress_data.py (рядом с этим файлом).
# Чтобы добавить слово — редактируй stress_data.py, затем:
#   systemctl restart asgard-silero
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from stress_data import STRESS_SORTED
    _stress_rules = STRESS_SORTED
except ImportError:
    _stress_rules = []

def apply_stress(text: str) -> str:
    """Применяет словарь ударений. Длинные фразы заменяются первыми."""
    for word, stressed in _stress_rules:
        text = re.sub(re.escape(word), stressed, text, flags=re.IGNORECASE)
    return text

logging.basicConfig(level=logging.INFO, format='%(asctime)s [Silero] %(levelname)s: %(message)s')
log = logging.getLogger('silero-tts')

# ── Загрузка модели ─────────────────────────────────────────────
model = None
model_lock = threading.Lock()

def load_model():
    global model
    try:
        import torch
        log.info('Загрузка Silero TTS v5_ru...')
        t0 = time.time()

        model_path = os.path.join(os.path.dirname(__file__), '..', 'models', 'silero_v5_ru.pt')
        os.makedirs(os.path.dirname(model_path), exist_ok=True)

        device = torch.device('cpu')
        torch.set_num_threads(4)

        if os.path.exists(model_path):
            log.info(f'Загружаем из кэша: {model_path}')
            m = torch.package.PackageImporter(model_path).load_pickle('tts_models', 'model')
        else:
            log.info('Скачиваем модель с silero.ai...')
            torch.hub.download_url_to_file(
                'https://models.silero.ai/models/tts/ru/v5_ru.pt',
                model_path
            )
            m = torch.package.PackageImporter(model_path).load_pickle('tts_models', 'model')

        m.to(device)
        model = m
        log.info(f'Silero TTS готов за {time.time()-t0:.1f}с')
        return True
    except Exception as e:
        log.error(f'Ошибка загрузки Silero: {e}')
        return False

def synthesize(text: str, speaker: str = 'xenia') -> bytes:
    """
    Синтез текста в PCM slin16 8000Hz (для Asterisk AudioSocket).
    Silero синтезирует в 48kHz, scipy ресемплирует до 8kHz.
    """
    import torch
    import numpy as np

    if not text or not text.strip():
        return b''

    text = text.strip()
    text = apply_stress(text)
    if len(text) > 500:
        text = text[:500]

    with model_lock:
        try:
            # Синтез в 48kHz (максимальное качество)
            audio_48k = model.apply_tts(
                text=text,
                speaker=speaker,
                sample_rate=48000
            )
            audio_np = audio_48k.numpy() if hasattr(audio_48k, 'numpy') else __import__('numpy').array(audio_48k)
        except Exception as e:
            log.error(f'Silero synthesis error: {e}')
            raise

    # Ресемплинг 48kHz → 8kHz (коэффициент 1:6)
    try:
        from scipy.signal import resample_poly
        audio_8k = resample_poly(audio_np, up=1, down=6)
    except ImportError:
        audio_8k = audio_np[::6]

    # Нормализация и конвертация в int16 (slin16)
    import numpy as np
    peak = np.max(np.abs(audio_8k))
    if peak > 0:
        audio_8k = audio_8k / peak * 0.9  # headroom 10%

    audio_int16 = (audio_8k * 32767).astype(np.int16)
    return audio_int16.tobytes()


# ── HTTP сервер ─────────────────────────────────────────────────
class TTSHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        pass  # отключаем стандартный лог HTTP

    def do_GET(self):
        if self.path == '/health':
            status = 'ready' if model is not None else 'loading'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': status}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != '/tts':
            self.send_response(404)
            self.end_headers()
            return

        if model is None:
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"model not loaded"}')
            return

        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            text = data.get('text', '').strip()
            speaker = data.get('speaker', 'xenia')

            if not text:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"text required"}')
                return

            t0 = time.time()
            pcm = synthesize(text, speaker)
            ms = int((time.time() - t0) * 1000)

            log.info(f'TTS: "{text[:50]}..." -> {len(pcm)}b в {ms}ms (speaker={speaker})')

            self.send_response(200)
            self.send_header('Content-Type', 'audio/pcm')
            self.send_header('Content-Length', str(len(pcm)))
            self.send_header('X-Duration-Ms', str(ms))
            self.end_headers()
            self.wfile.write(pcm)

        except Exception as e:
            log.error(f'TTS request error: {e}')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())


def main():
    port = int(os.environ.get('SILERO_PORT', 8765))

    # Загружаем модель в отдельном потоке чтобы сервер стартовал быстро
    t = threading.Thread(target=load_model, daemon=True)
    t.start()

    server = HTTPServer(('127.0.0.1', port), TTSHandler)
    log.info(f'Silero TTS Service запущен на порту {port}')
    log.info('Ожидаем загрузки модели...')
    server.serve_forever()


if __name__ == '__main__':
    main()
