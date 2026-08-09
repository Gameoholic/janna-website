"""
Голос (master-prompt 8D) — a tiny warm local transcription service.

Loads a faster-whisper model once and keeps it in memory so repeated
recordings don't pay model-load cost every time. Talks plain HTTP on
127.0.0.1 only — Node (server/src/whisper.ts) is the only client, and the
port is never exposed outside the container.

Two endpoints:
  POST /transcribe        body = raw 16kHz mono PCM WAV bytes -> {"text": "..."}
  POST /reload?model=X    swaps the loaded model in-process   -> {"ok": true}

No web framework dependency on purpose — this is two endpoints, and
http.server keeps the image's Python footprint small.
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

PORT = int(os.environ.get("WHISPER_SERVICE_PORT", "8078"))
CACHE_DIR = os.environ.get("WHISPER_CACHE_DIR") or None
DEFAULT_MODEL = os.environ.get("WHISPER_DEFAULT_MODEL", "small")

state = {"model_name": None, "model": None}


def load_model(name: str) -> None:
    print(f"[whisper] loading model '{name}'...", flush=True)
    started = time.time()
    model = WhisperModel(name, device="cpu", compute_type="int8", download_root=CACHE_DIR)
    state["model"] = model
    state["model_name"] = name
    print(f"[whisper] model '{name}' ready in {time.time() - started:.1f}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    # Quiet the default per-request access log line; we log what matters ourselves.
    def log_message(self, fmt, *args):
        pass

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/transcribe":
            self._handle_transcribe()
        elif self.path.startswith("/reload"):
            self._handle_reload()
        else:
            self._json(404, {"error": "not found"})

    def _handle_transcribe(self):
        length = int(self.headers.get("Content-Length", 0))
        wav_bytes = self.rfile.read(length)
        tmp_path = f"/tmp/voice-{time.time_ns()}.wav"
        try:
            with open(tmp_path, "wb") as f:
                f.write(wav_bytes)
            started = time.time()
            segments, _info = state["model"].transcribe(tmp_path, language="ru")
            text = "".join(seg.text for seg in segments).strip()
            print(f"[whisper] transcribed in {time.time() - started:.1f}s ({len(wav_bytes)} bytes)", flush=True)
            self._json(200, {"text": text})
        except Exception as e:  # noqa: BLE001 — report failure to Node, keep the service alive
            print(f"[whisper] transcribe error: {e}", flush=True)
            self._json(500, {"error": str(e)})
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    def _handle_reload(self):
        from urllib.parse import urlparse, parse_qs

        query = parse_qs(urlparse(self.path).query)
        model_name = (query.get("model") or [""])[0]
        if not model_name:
            self._json(400, {"error": "missing model"})
            return
        try:
            load_model(model_name)
            self._json(200, {"ok": True, "model": model_name})
        except Exception as e:  # noqa: BLE001 — bad model name etc. shouldn't crash the service
            print(f"[whisper] reload error: {e}", flush=True)
            self._json(500, {"error": str(e)})


def main():
    load_model(DEFAULT_MODEL)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[whisper] listening on 127.0.0.1:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
