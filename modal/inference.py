"""
Brainiac — Modal GPU worker
MOCK_MODE = True: uses synthetic ROI scores + real image-based heatmap.
When Meta FAIR releases the tribev2 package, set MOCK_MODE = False.

Deploy: modal deploy modal/inference.py
After deploy: copy the web endpoint URL to MODAL_INFERENCE_URL in Vercel env vars.

Secrets required in Modal dashboard (name: "brainiac-supabase"):
  - SUPABASE_SERVICE_ROLE_KEY
"""

import io
import os
import datetime

import modal

# ── Toggle this when tribev2 becomes pip-installable ─────────────────────────
MOCK_MODE = True
# ─────────────────────────────────────────────────────────────────────────────

app = modal.App("brainiac-inference")

model_volume = modal.Volume.from_name("brainiac-tribe-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "opencv-python-headless",
        "matplotlib",
        "numpy",
        "Pillow",
        "scipy",
        "supabase",
    )
)

# ROI registry — mirrors src/lib/roi.ts
ROI_REGISTRY = {
    "FFA":     {"label": "Face Detection",           "description": "A face or face-like element is visually dominant in this image."},
    "V1_V2":   {"label": "Low-Level Visual Signal",   "description": "Strong contrast, edges, or luminance variation is present."},
    "V4":      {"label": "Color and Form Processing", "description": "Color relationships and shape boundaries are being processed."},
    "LO":      {"label": "Object Recognition",        "description": "Distinct objects or elements are registering as meaningful visual units."},
    "PPA":     {"label": "Scene Recognition",         "description": "The background or setting is being processed as contextual information."},
    "STS":     {"label": "Social and Motion Cues",    "description": "Biological motion, expressions, or implied action is present."},
    "DAN":     {"label": "Spatial Attention",         "description": "The composition is directing spatial focus toward specific elements."},
    "VWFA":    {"label": "Text Processing",           "description": "Text in this image is legible and occupying visual attention."},
    "DMN":     {"label": "Default Mode Network",      "description": "Self-referential or mind-wandering processes are relatively active."},
    "AV_ASSOC":{"label": "Audio-Visual Association",  "description": "Cross-modal binding regions are active."},
}


def mock_roi_scores(image_array) -> tuple[list[dict], float]:
    """
    Derive plausible ROI activation scores from actual image properties.
    Not a brain model — uses image statistics as a stand-in until tribev2 is available.
    """
    import numpy as np

    img = image_array.astype(np.float32) / 255.0
    h, w = img.shape[:2]

    # Image-derived signals
    gray = img.mean(axis=2)
    contrast = float(gray.std())
    brightness = float(gray.mean())
    color_var = float(img.std(axis=(0, 1)).mean())

    # Center crop — faces/subjects tend to be centered in thumbnails
    cy, cx = h // 2, w // 2
    center = gray[cy - h//6:cy + h//6, cx - w//6:cx + w//6]
    center_contrast = float(center.std()) if center.size > 0 else 0.0

    # Top strip — text is often at top or bottom
    top_strip = gray[:h // 5, :]
    top_brightness_var = float(top_strip.std())

    # Derive scores in [0, 1] from image properties
    scores = {
        "FFA":      min(1.0, center_contrast * 3.5 + 0.15),
        "V1_V2":    min(1.0, contrast * 2.8 + 0.1),
        "V4":       min(1.0, color_var * 2.2 + 0.2),
        "LO":       min(1.0, (contrast + center_contrast) * 1.4 + 0.1),
        "PPA":      min(1.0, (1.0 - center_contrast) * 0.8 + brightness * 0.4),
        "STS":      min(1.0, center_contrast * 2.0 + 0.05),
        "DAN":      min(1.0, contrast * 1.5 + 0.2),
        "VWFA":     min(1.0, top_brightness_var * 3.0 + 0.08),
        "DMN":      min(1.0, (1.0 - contrast) * 0.6 + 0.1),
        "AV_ASSOC": min(1.0, color_var * 1.2 + 0.05),
    }

    results = [
        {
            "region_key": key,
            "label": ROI_REGISTRY[key]["label"],
            "activation": round(val, 4),
            "description": ROI_REGISTRY[key]["description"],
        }
        for key, val in scores.items()
    ]
    results.sort(key=lambda x: x["activation"], reverse=True)

    mean_top = float(np.mean([r["activation"] for r in results[:3]]))
    return results, round(mean_top, 4)


def generate_heatmap(image_bytes: bytes, roi_data: list[dict]) -> bytes:
    """
    Generate a viridis heatmap overlay driven by the ROI activation scores.
    Higher-activation regions get warmer colors.
    """
    import numpy as np
    import matplotlib.cm as cm
    from PIL import Image
    from scipy.ndimage import gaussian_filter

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(img, dtype=np.float32)
    h, w = img_array.shape[:2]

    # Build spatial attention map from ROI scores
    # Each ROI maps to a rough spatial prior on the image
    spatial_map = np.zeros((h, w), dtype=np.float32)

    score = {r["region_key"]: r["activation"] for r in roi_data}

    # Spatial priors: where each ROI tends to activate in image space
    def add_gaussian(arr, cy_frac, cx_frac, sigma_frac, weight):
        cy = int(cy_frac * h)
        cx = int(cx_frac * w)
        sigma = sigma_frac * min(h, w)
        y, x = np.ogrid[:h, :w]
        g = np.exp(-((y - cy)**2 + (x - cx)**2) / (2 * sigma**2))
        arr += g * weight

    add_gaussian(spatial_map, 0.45, 0.50, 0.25, score.get("FFA", 0))      # center (faces)
    add_gaussian(spatial_map, 0.50, 0.50, 0.45, score.get("V1_V2", 0))    # whole image (edges)
    add_gaussian(spatial_map, 0.50, 0.50, 0.40, score.get("V4", 0))       # whole image (color)
    add_gaussian(spatial_map, 0.45, 0.50, 0.30, score.get("LO", 0))       # center objects
    add_gaussian(spatial_map, 0.70, 0.50, 0.35, score.get("PPA", 0))      # background/lower
    add_gaussian(spatial_map, 0.40, 0.50, 0.25, score.get("STS", 0))      # upper center
    add_gaussian(spatial_map, 0.35, 0.65, 0.20, score.get("DAN", 0))      # upper right
    add_gaussian(spatial_map, 0.15, 0.50, 0.20, score.get("VWFA", 0))     # top (text)
    add_gaussian(spatial_map, 0.50, 0.25, 0.25, score.get("DMN", 0))      # left side
    add_gaussian(spatial_map, 0.50, 0.75, 0.20, score.get("AV_ASSOC", 0)) # right side

    spatial_map = gaussian_filter(spatial_map, sigma=min(h, w) * 0.08)

    mn, mx = spatial_map.min(), spatial_map.max()
    spatial_norm = (spatial_map - mn) / (mx - mn + 1e-8)

    colormap = cm.get_cmap("viridis")
    heatmap_rgb = (colormap(spatial_norm)[:, :, :3] * 255).astype(np.float32)

    alpha = 0.45
    blended = (img_array * (1 - alpha) + heatmap_rgb * alpha).clip(0, 255).astype(np.uint8)

    out = io.BytesIO()
    Image.fromarray(blended).save(out, format="PNG", optimize=True)
    return out.getvalue()


@app.function(
    image=image,
    volumes={"/cache": model_volume},
    timeout=120,
    secrets=[modal.Secret.from_name("brainiac-supabase")],
    # gpu="T4",  # uncomment when switching to real TRIBE v2 inference
)
@modal.fastapi_endpoint(method="POST", label="brainiac-inference")
def run_inference(body: dict) -> dict:
    """
    Web endpoint called by Next.js API routes.
    Body: { analysis_id, storage_key, supabase_url }
    """
    import numpy as np
    import cv2
    from supabase import create_client

    analysis_id: str = body["analysis_id"]
    storage_key: str = body["storage_key"]
    supabase_url: str = body["supabase_url"]
    service_role_key: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    db = create_client(supabase_url, service_role_key)

    def fail(msg: str):
        db.table("analyses").update({
            "status": "failed",
            "error_message": msg,
        }).eq("id", analysis_id).execute()
        return {"status": "failed", "error": msg}

    # ── Download image from Supabase Storage ──────────────────────────────────
    try:
        response = db.storage.from_("creatives").download(storage_key)
        image_bytes = bytes(response)
    except Exception as e:
        return fail(f"Storage download failed: {e}")

    # ── Decode image ──────────────────────────────────────────────────────────
    try:
        img_array = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return fail("Could not decode image")
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    except Exception as e:
        return fail(f"Image decode failed: {e}")

    # ── Inference (mock or real) ───────────────────────────────────────────────
    if MOCK_MODE:
        roi_data, mean_top_roi_score = mock_roi_scores(img_rgb)
    else:
        # Real TRIBE v2 — uncomment when tribev2 is pip-installable
        # from tribev2 import TribeModel
        # import imageio.v3 as iio, tempfile
        # model = TribeModel.from_pretrained("facebook/tribev2", cache_folder="/cache")
        # ... (full inference pipeline)
        return fail("Real inference not yet configured. Set MOCK_MODE = True.")

    # ── Heatmap ───────────────────────────────────────────────────────────────
    try:
        heatmap_bytes = generate_heatmap(image_bytes, roi_data)
    except Exception as e:
        return fail(f"Heatmap generation failed: {e}")

    # ── Upload heatmap ────────────────────────────────────────────────────────
    heatmap_key = f"{analysis_id}.png"
    try:
        db.storage.from_("heatmaps").upload(
            heatmap_key,
            heatmap_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
        heatmap_url = db.storage.from_("heatmaps").get_public_url(heatmap_key)
    except Exception as e:
        return fail(f"Heatmap upload failed: {e}")

    # ── Update analyses row ───────────────────────────────────────────────────
    db.table("analyses").update({
        "status": "complete",
        "heatmap_storage_key": heatmap_key,
        "heatmap_url": heatmap_url,
        "roi_data": roi_data,
        "mean_top_roi_score": mean_top_roi_score,
        "completed_at": datetime.datetime.utcnow().isoformat(),
    }).eq("id", analysis_id).execute()

    return {
        "status": "complete",
        "analysis_id": analysis_id,
        "mean_top_roi_score": mean_top_roi_score,
        "mock": MOCK_MODE,
    }
