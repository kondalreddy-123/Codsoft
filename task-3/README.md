# CaptionVerse – 3D AI Image Captioning (Flask + BLIP)

```
CaptionVerse/
├── index.html         3D frontend (Three.js, upload/paste/drag-drop, length + language, copy, PNG download)
├── app.py             Flask API + pretrained BLIP model
├── requirements.txt
└── README.md
```

## Run on Windows (PowerShell)

```powershell
cd path\to\CaptionVerse
python -m venv .venv
.\.venv\Scripts\Activate.ps1
# if activation is blocked:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000** in your browser (Flask serves `index.html`).
You may also open `index.html` directly from disk; it calls the API at the address set in the
single `API_BASE` constant at the top of the script in `index.html`.

**First run:** `Salesforce/blip-image-captioning-base` (about 1 GB) is downloaded from Hugging Face
and cached, so the first start needs internet and takes a few minutes. Later starts load from cache.
The model is loaded once at startup and runs on CPU (a caption takes a few seconds). The 3D background
loads Three.js from a CDN, so the page also needs internet.

## API

| Endpoint | Description |
|---|---|
| `POST /api/caption` | form-data: `image`, `length` (short/medium/long), `language` (code). Returns `caption`, `english_caption`, `language_returned`, `note`, `steps`, `model` |
| `GET /api/health` | model/translator status |

Errors return JSON `{ "error": "..." }` with 400 (missing field), 413 (over 8 MB), 415 (unsupported type),
422 (corrupt image), 500 (processing/inference) or 503 (model not loaded). Uploaded images are processed
in memory only; image bytes are never logged or written to disk.

## Speed

The first caption after startup is fast because the model is warmed up when the server starts. Other speed-ups:
int8 dynamic quantisation (`CAPTION_QUANTIZE=0` turns it off if you prefer full precision), greedy or
2-beam decoding, smaller images, a server cache (repeat requests return in milliseconds), and a browser
prefetch that fetches the other two lengths after the first caption so Short/Medium/Long switching is
instant. The UI shows how long each caption took. Speed depends on your CPU: expect roughly one to a few
seconds for a first caption on a typical laptop, not literally zero.

## Caption length

BLIP does not support exact word counts. Short / Medium / Long change generation settings
(`min_new_tokens`, `max_new_tokens`, repetition penalties in `LENGTH_PARAMS`). Long captions from the
base model can be generic or somewhat repetitive; `clean_caption()` removes simple repeated phrases.

## Languages (optional translation)

BLIP-base produces **English only**. By default, choosing another language returns the English caption
with a visible note. To enable real translation, set one of these before `python app.py`:

```powershell
# Local NLLB model (downloads ~2.4 GB on first translation; needs sentencepiece, already in requirements)
$env:CAPTION_TRANSLATOR="nllb"

# or a LibreTranslate server you run/own
$env:CAPTION_TRANSLATOR="libretranslate"
$env:LIBRETRANSLATE_URL="http://127.0.0.1:5001"
$env:LIBRETRANSLATE_API_KEY="optional-key"   # stays on the server
```

The page only labels a caption with a non-English language when the server reports that translation
succeeded. Translation quality is not guaranteed.

## Pipeline description

BLIP is a single pretrained vision-language architecture (ViT image encoder feeding a text decoder).
This project does **not** implement a separate VGG/ResNet encoder plus RNN/Transformer decoder.
The UI steps are: image preprocessing → BLIP inference → caption finalising; a step turns green only
if the server reports it succeeded. If your evaluation requires an explicitly separate CNN encoder and
RNN/Transformer decoder, you would need a different model (for example ResNet + LSTM trained on
Flickr8k/COCO). The inference code sits in one place in `app.py` (`caption()`), so a second pipeline can
be added behind the same endpoint.

## Download

"Download image + caption" draws the image and caption onto a canvas and saves a PNG using a normal
browser download. Non-Latin scripts depend on fonts installed on your device.

## Security notes

8 MB upload limit; image type validated by decoding with Pillow; files are never executed; CORS is
limited to localhost/127.0.0.1 and `file://` pages; no API keys in frontend code.
