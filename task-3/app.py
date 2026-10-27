"""CaptionVerse backend: Flask API around the pretrained BLIP captioning model.

POST /api/caption   multipart/form-data: image=<file>, length=short|medium|long, language=<code>
GET  /api/health    model/translator status
GET  /              serves index.html (same-origin, no CORS needed)
"""
import io
import logging
import os
import re
import json
import time
import hashlib
import threading
from collections import OrderedDict
import urllib.request

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError

# ---------------------------------------------------------------- config
MODEL_ID = "Salesforce/blip-image-captioning-base"
MAX_UPLOAD_MB = 8
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP"}
# Translation is OPTIONAL: none (default) | nllb | libretranslate
TRANSLATOR = os.environ.get("CAPTION_TRANSLATOR", "none").lower()
NLLB_ID = os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
LIBRETRANSLATE_URL = os.environ.get("LIBRETRANSLATE_URL", "")      # e.g. http://127.0.0.1:5001
LIBRETRANSLATE_KEY = os.environ.get("LIBRETRANSLATE_API_KEY", "")  # stays server-side
PORT = int(os.environ.get("PORT", "5000"))

# BLIP is English-only; these are generation settings, NOT exact word counts.
# Tuned for speed on CPU: greedy decoding for short, small beams for the longer ones.
LENGTH_PARAMS = {
    "short":  dict(num_beams=1, min_new_tokens=5,  max_new_tokens=20, repetition_penalty=1.2),
    "medium": dict(num_beams=2, min_new_tokens=25, max_new_tokens=45, repetition_penalty=1.4, no_repeat_ngram_size=3),
    "long":   dict(num_beams=2, min_new_tokens=50, max_new_tokens=90, repetition_penalty=1.6, no_repeat_ngram_size=3),
}
QUANTIZE = os.environ.get("CAPTION_QUANTIZE", "1") == "1"  # int8 dynamic quantisation: faster on CPU
NLLB_CODES = {
    "hi": "hin_Deva", "te": "tel_Telu", "ta": "tam_Taml", "kn": "kan_Knda", "ml": "mal_Mlym",
    "bn": "ben_Beng", "mr": "mar_Deva", "gu": "guj_Gujr", "ur": "urd_Arab", "es": "spa_Latn",
    "fr": "fra_Latn", "de": "deu_Latn", "it": "ita_Latn", "pt": "por_Latn", "ru": "rus_Cyrl",
    "ar": "arb_Arab", "zh": "zho_Hans", "ja": "jpn_Jpan", "ko": "kor_Hang",
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("captionverse")  # never log image bytes

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000
# Local development only: localhost/127.0.0.1 on any port, plus file:// pages ("null" origin).
CORS(app, resources={r"/api/*": {"origins": [r"http://(localhost|127\.0\.0\.1)(:\d+)?", "null"]}})

# ---------------------------------------------------------------- model (loaded ONCE at startup)
torch = processor = model = None
MODEL_ERROR = None
try:
    import torch
    from transformers import BlipForConditionalGeneration, BlipProcessor

    log.info("Loading %s (first run downloads ~1 GB)...", MODEL_ID)
    processor = BlipProcessor.from_pretrained(MODEL_ID)
    model = BlipForConditionalGeneration.from_pretrained(MODEL_ID).to("cpu").eval()
    torch.set_num_threads(os.cpu_count() or 4)
    if QUANTIZE:
        try:
            model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
            log.info("int8 dynamic quantisation enabled.")
        except Exception as q_exc:
            log.warning("Quantisation skipped: %s", type(q_exc).__name__)
    log.info("Warming up the model...")  # first inference is always slow; do it now, not on the user's first image
    with torch.inference_mode():
        model.generate(**processor(images=Image.new("RGB", (384, 384), "gray"), return_tensors="pt"), **LENGTH_PARAMS["short"])
    log.info("Model ready (CPU).")
except Exception as exc:  # model/network/dependency problems are reported via the API
    MODEL_ERROR = f"{type(exc).__name__}: {exc}"
    log.error("Model failed to load: %s", MODEL_ERROR)

_nllb = {}  # lazy cache: tokenizer + model
INFER_LOCK = threading.Lock()
_cache = OrderedDict()  # (image sha1, length) -> English caption; repeat requests are instant
_tr_cache = {}          # (english caption, language) -> (translation, note)


def _cache_get(key):
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]


def _cache_put(key, value):
    _cache[key] = value
    while len(_cache) > 64:
        _cache.popitem(last=False)


def translate(text, lang):
    """Return (translated_text or None, note). Never fabricates a translation."""
    if TRANSLATOR == "none":
        return None, "Translation is not configured on the server, so the English caption is shown. See README (CAPTION_TRANSLATOR)."
    try:
        if TRANSLATOR == "nllb":
            if lang not in NLLB_CODES:
                return None, "This language is not supported by the translation model; showing English."
            if not _nllb:
                from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
                _nllb["tok"] = AutoTokenizer.from_pretrained(NLLB_ID, src_lang="eng_Latn")
                _nllb["mdl"] = AutoModelForSeq2SeqLM.from_pretrained(NLLB_ID).eval()
            tok, mdl = _nllb["tok"], _nllb["mdl"]
            inputs = tok(text, return_tensors="pt", truncation=True, max_length=256)
            with torch.inference_mode():
                out = mdl.generate(**inputs, forced_bos_token_id=tok.convert_tokens_to_ids(NLLB_CODES[lang]), max_new_tokens=256, num_beams=4)
            return tok.batch_decode(out, skip_special_tokens=True)[0], "Translated from the English BLIP caption with NLLB."
        if TRANSLATOR == "libretranslate" and LIBRETRANSLATE_URL:
            payload = {"q": text, "source": "en", "target": "zh" if lang == "zh" else lang, "format": "text"}
            if LIBRETRANSLATE_KEY:
                payload["api_key"] = LIBRETRANSLATE_KEY
            req = urllib.request.Request(LIBRETRANSLATE_URL.rstrip("/") + "/translate", json.dumps(payload).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read())["translatedText"], "Translated from the English BLIP caption with LibreTranslate."
        return None, "Translator is misconfigured; showing the English caption."
    except Exception as exc:
        log.error("Translation failed: %s", type(exc).__name__)
        return None, "Translation failed, so the English caption is shown."


def clean_caption(text):
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\b(\w+(?:\s+\w+){0,3})(?:\s+\1\b)+", r"\1", text, flags=re.I)  # collapse repeated phrases
    if not text:
        return text
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".!?" else text + "."


def err(message, status):
    return jsonify({"error": message}), status


# ---------------------------------------------------------------- routes
@app.errorhandler(413)
def too_large(_):
    return err(f"Image is too large (limit {MAX_UPLOAD_MB} MB).", 413)


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify(status="ok", model=MODEL_ID, model_loaded=model is not None, error=MODEL_ERROR,
                   translator=TRANSLATOR)


@app.post("/api/caption")
def caption():
    if model is None:
        return err("The captioning model is not available: " + (MODEL_ERROR or "unknown error"), 503)
    file = request.files.get("image")
    if file is None or not file.filename:
        return err("No image uploaded (expected form field 'image').", 400)
    length = request.form.get("length", "medium")
    lang = request.form.get("language", "en")
    if length not in LENGTH_PARAMS:
        return err("length must be short, medium or long.", 400)

    t0 = time.perf_counter()
    steps = {"preprocess": False, "inference": False, "finalize": False}
    raw = file.read()
    key = (hashlib.sha1(raw).hexdigest(), length)
    english = _cache_get(key)
    cached = english is not None
    if cached:
        steps.update(preprocess=True, inference=True)
    else:
        try:  # --- 1. validate + preprocess
            try:
                probe = Image.open(io.BytesIO(raw))
                if probe.format not in ALLOWED_FORMATS:
                    return err("Unsupported image type. Use JPEG, PNG, WEBP, GIF or BMP.", 415)
                probe.verify()
                img = Image.open(io.BytesIO(raw)).convert("RGB")  # reopen: verify() invalidates the first handle
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
                return err("The uploaded file is not a valid image.", 422)
            img.thumbnail((768, 768))
            inputs = processor(images=img, return_tensors="pt")
            steps["preprocess"] = True
        except Exception as exc:
            log.error("Preprocessing failed: %s", type(exc).__name__)
            return err("Could not process the image.", 500)
        try:  # --- 2. BLIP inference (vision encoder + text decoder run inside generate())
            with INFER_LOCK, torch.inference_mode():
                ids = model.generate(**inputs, **LENGTH_PARAMS[length])
            english = clean_caption(processor.decode(ids[0], skip_special_tokens=True))
            _cache_put(key, english)
            steps["inference"] = True
        except Exception as exc:
            log.error("Inference failed: %s", type(exc).__name__)
            return err("Caption generation failed on the server.", 500)

    # --- 3. finalise (+ optional translation)
    final, returned, note = english, "en", ""
    if lang != "en":
        translated, note = _tr_cache.get((english, lang)) or translate(english, lang)
        if translated:
            _tr_cache[(english, lang)] = (translated, note)
            final, returned = translated, lang
    steps["finalize"] = True
    return jsonify(caption=final, english_caption=english, language_requested=lang, language_returned=returned,
                   length=length, note=note, steps=steps, model=MODEL_ID,
                   cached=cached, ms=round((time.perf_counter() - t0) * 1000))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False)
