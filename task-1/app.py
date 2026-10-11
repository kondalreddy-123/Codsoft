
import os
import json
import uuid

import cv2
import numpy as np
from flask import Flask, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
KNOWN_DIR = os.path.join(BASE_DIR, "known_faces")
REGISTRY_FILE = os.path.join(KNOWN_DIR, "registry.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(KNOWN_DIR, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

DETECTOR_MODEL = os.path.join(
    MODEL_DIR, "face_detection_yunet_2023mar.onnx"
)
RECOGNIZER_MODEL = os.path.join(
    MODEL_DIR, "face_recognition_sface_2021dec.onnx"
)

# Cosine similarity threshold; adjust after testing your own photos.
MATCH_THRESHOLD = 0.363

if not os.path.exists(DETECTOR_MODEL):
    raise FileNotFoundError(f"Missing model: {DETECTOR_MODEL}")

if not os.path.exists(RECOGNIZER_MODEL):
    raise FileNotFoundError(f"Missing model: {RECOGNIZER_MODEL}")

detector = cv2.FaceDetectorYN.create(
    DETECTOR_MODEL, "", (320, 320), 0.8, 0.3, 5000
)
recognizer = cv2.FaceRecognizerSF.create(RECOGNIZER_MODEL, "")


def read_image(file_storage):
    """Read an uploaded image safely."""
    if not file_storage or not file_storage.filename:
        return None

    filename = secure_filename(file_storage.filename)
    extension = os.path.splitext(filename)[1].lower()

    if extension not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
        return None

    data = file_storage.read()
    if not data:
        return None

    image = cv2.imdecode(
        np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR
    )
    return image


def detect_faces(image):
    """Return YuNet face detections."""
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    return faces


def get_face_feature(image, face):
    """Align a detected face and extract its SFace feature vector."""
    aligned = recognizer.alignCrop(image, face)
    feature = recognizer.feature(aligned)
    return feature.flatten().astype(float)


def load_registry():
    if not os.path.exists(REGISTRY_FILE):
        return []

    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_registry(registry):
    temporary_file = REGISTRY_FILE + ".tmp"
    with open(temporary_file, "w", encoding="utf-8") as file:
        json.dump(registry, file, indent=2)
    os.replace(temporary_file, REGISTRY_FILE)


def identify_face(feature, registry):
    """Return the best registered name if its score passes the threshold."""
    best_name = "Unknown Person"
    best_score = -1.0

    for person in registry:
        try:
            known_feature = np.asarray(
                person["feature"], dtype=np.float32
            ).reshape(1, -1)
            current_feature = np.asarray(
                feature, dtype=np.float32
            ).reshape(1, -1)

            score = float(
                recognizer.match(
                    current_feature,
                    known_feature,
                    cv2.FaceRecognizerSF_FR_COSINE
                )
            )

            if score > best_score:
                best_score = score
                best_name = person["name"]
        except (KeyError, TypeError, ValueError):
            continue

    if best_score < MATCH_THRESHOLD:
        return "Unknown Person", best_score

    return best_name, best_score


@app.route("/")
def home():
    return render_template(
        "index.html",
        result_image=None,
        face_count=None,
        message=None,
        registered_people=[
            person["name"] for person in load_registry()
        ]
    )


@app.route("/register", methods=["POST"])
def register():
    name = request.form.get("name", "").strip()
    image = read_image(request.files.get("image"))

    if not name or len(name) > 80:
        return render_template(
            "index.html",
            message="Enter a name between 1 and 80 characters.",
            registered_people=[
                p["name"] for p in load_registry()
            ]
        )

    if image is None:
        return render_template(
            "index.html",
            message="Upload a valid JPG, PNG, BMP, or WEBP photo.",
            registered_people=[
                p["name"] for p in load_registry()
            ]
        )

    faces = detect_faces(image)

    if faces is None or len(faces) != 1:
        return render_template(
            "index.html",
            message="The registration photo must contain exactly one detectable face.",
            registered_people=[
                p["name"] for p in load_registry()
            ]
        )

    feature = get_face_feature(image, faces[0])
    registry = load_registry()

    # Replace the existing reference if this name is already registered.
    registry = [
        person for person in registry
        if person.get("name", "").casefold() != name.casefold()
    ]
    registry.append({
        "name": name,
        "feature": feature.tolist()
    })
    save_registry(registry)

    return render_template(
        "index.html",
        message=f"Successfully registered {name}!",
        registered_people=[p["name"] for p in registry]
    )


@app.route("/detect", methods=["POST"])
def detect():
    image = read_image(request.files.get("image"))

    if image is None:
        return render_template(
            "index.html",
            message="Please upload a valid image file.",
            registered_people=[
                p["name"] for p in load_registry()
            ]
        )

    faces = detect_faces(image)
    registry = load_registry()
    face_count = 0 if faces is None else len(faces)

    if faces is not None:
        for index, face in enumerate(faces, start=1):
            x, y, width, height = map(int, face[:4])
            feature = get_face_feature(image, face)
            name, score = identify_face(feature, registry)

            # Draw the face rectangle and name.
            color = (0, 180, 0) if name != "Unknown Person" else (0, 0, 255)
            cv2.rectangle(
                image, (x, y), (x + width, y + height), color, 2
            )

            label = name
            if name != "Unknown Person":
                label += f" ({score:.2f} match)"

            text_y = max(y - 10, 25)
            cv2.putText(
                image, label, (x, text_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2
            )

            # Draw YuNet's five facial landmarks.
            for point_index in range(5):
                px = int(face[4 + 2 * point_index])
                py = int(face[5 + 2 * point_index])
                cv2.circle(image, (px, py), 2, (255, 180, 0), -1)

    output_name = f"result_{uuid.uuid4().hex}.jpg"
    output_path = os.path.join(UPLOAD_DIR, output_name)

    if not cv2.imwrite(output_path, image):
        return render_template(
            "index.html",
            message="Could not save the result image.",
            registered_people=[
                p["name"] for p in registry
            ]
        )

    return render_template(
        "index.html",
        result_image=f"/uploads/{output_name}",
        face_count=face_count,
        message="Recognition complete.",
        registered_people=[p["name"] for p in registry]
    )


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True)
