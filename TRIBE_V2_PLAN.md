# TRIBE v2 Real Inference — Implementation Plan

**Status:** Not started. `modal/inference.py` currently runs in `MOCK_MODE = True`,
deriving ROI scores from image statistics. This document is the full plan for replacing
that with real TRIBE v2 brain encoding inference.

**Do not start this work without reading the full plan first.**

---

## Background

**TRIBE v2** ("Toward Real-time fMRI Brain Encoding") is a foundation model from Meta FAIR
that predicts neural responses (fMRI BOLD signal) across the cortex in response to visual,
auditory, and language stimuli. It was published in 2024 under CC-BY-NC-4.0.

The model outputs predicted activation values across a ~20,000-vertex brain surface mesh
per hemisphere. To get per-ROI scores (FFA, V1/V2, V4, etc.), those vertex activations
must be averaged within the boundaries of each cortical region defined by a brain atlas.

The mock mode currently approximates this using image statistics (contrast, brightness,
color variance) as stand-ins. Real TRIBE v2 will produce genuine predicted neural
activations grounded in fMRI data.

---

## Step 1 — Locate the actual model weights and package

**Before writing any code, answer these questions:**

1. **Is `tribev2` a pip-installable package?**
   - The commented-out code in `modal/inference.py` references `from tribev2 import TribeModel`
   - Check: `pip index versions tribev2` and PyPI search
   - Check Meta FAIR GitHub: `github.com/facebookresearch` for any TRIBE/tribev2 repo

2. **Is the model on HuggingFace?**
   - Check: `huggingface.co/facebook/tribe-v2` or similar slugs
   - The `TribeModel.from_pretrained("facebook/tribev2")` call suggests HuggingFace Hub

3. **If no pip package exists, what is available?**
   - GitHub repo with manual weight download?
   - A research release with custom inference scripts?
   - HuggingFace model card with inference example?

4. **What Python version and dependencies does it require?**
   - The current Modal image uses Python 3.11 — confirm compatibility
   - Known dependencies to expect: `torch`, `torchvision`, `transformers`, `nibabel` (for brain mesh), possibly `nilearn`

**Do not proceed past Step 1 until the model source is confirmed.**

---

## Step 2 — Understand the model's input format

TRIBE v2 was trained on video stimuli (fMRI participants watched clips). For thumbnail
analysis we are passing static images. Two approaches exist:

**Option A — Static image as single frame**
- Pass the thumbnail as a single frame (or repeat it N times to form a short clip)
- The model's temporal backbone averages over frames; single/repeated frames are valid
- Simplest approach, lowest GPU cost

**Option B — Synthetic short video from thumbnail**
- Convert thumbnail to a 2–6 second video (center crop, subtle zoom, or looping)
- Closer to training distribution
- The original mock code referenced "6-second MP4" — this was the intended approach
- Use `ffmpeg` or `moviepy` in the Modal worker

**Recommended starting point:** Option A (single frame) for speed. Test correlation quality
vs. Option B before committing. Add a `VIDEO_MODE` toggle in `inference.py`.

**Preprocessing to confirm from the model card/paper:**
- Input resolution (likely 224×224 or 256×256)
- Normalization (ImageNet mean/std is standard)
- Whether the model expects RGB or BGR
- Whether temporal dimension is required and what the expected shape is

---

## Step 3 — Understand the model's output format

The model outputs predicted fMRI activations. The exact shape depends on the model
variant (left hemisphere only, both hemispheres, full surface, or parcellated).

**Key questions:**
1. Is the output a full vertex activation map (~20k vertices per hemisphere) or
   already parcellated into ROIs?
2. What is the output tensor shape? `[n_vertices]`? `[n_rois]`? `[time, n_vertices]`?
3. Are outputs normalized (z-scores, percent signal change, raw)?

**If output is full vertex map**, we need Step 4 (brain atlas / ROI vertex mapping).
**If output is already parcellated**, we may be able to map directly to our ROI keys.

---

## Step 4 — Obtain the ROI vertex map (if needed)

The function `extractROIActivations` in `src/lib/roi.ts` expects:
```typescript
roiVertexMap: Record<string, number[]>
// e.g. { "FFA": [1234, 1235, ...], "V1_V2": [0, 1, 2, ...], ... }
```

This maps each of our 10 ROI keys to the vertex indices in the brain mesh where that
region is defined. This mapping comes from a brain atlas.

**How to get this:**

1. **From the TRIBE v2 model itself** — some brain encoding models ship with an atlas
   mapping as part of the package. Check the model card and repo.

2. **HCP MMP 1.0 parcellation** — the Human Connectome Project Multi-Modal Parcellation
   is the standard atlas used in much of this literature. It defines 360 regions across
   the cortex. Map our 10 ROI keys to their HCP MMP region indices.
   - Download: `github.com/waylan/hcp-utils` or `nilearn.datasets.fetch_atlas_destrieux`
   - The mapping between HCP MMP regions and our labels (FFA, V1_V2, etc.) is documented
     in the TRIBE v2 paper's supplementary materials

3. **From the paper's Figure/Table** — the paper likely reports which parcels correspond
   to each functional region. Extract vertex lists from the parcellation file for those
   parcel IDs.

**The vertex map should be generated once and hardcoded as a Python dict in `inference.py`**,
not recomputed at runtime. It is static data derived from the atlas.

---

## Step 5 — Update `modal/inference.py`

With Steps 1–4 complete, update the worker:

```python
MOCK_MODE = False  # flip this

# In the Modal image definition, add:
.pip_install("tribev2")  # or whatever the actual package name is
# Plus any additional deps: torch, transformers, nibabel, etc.

# In run_inference():
from tribev2 import TribeModel  # or equivalent import
model = TribeModel.from_pretrained("facebook/tribev2", cache_folder="/cache")

# Preprocessing
img_resized = cv2.resize(img_rgb, (224, 224))  # confirm resolution
img_normalized = (img_resized / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
img_tensor = torch.tensor(img_normalized).permute(2, 0, 1).unsqueeze(0)

# If video mode needed:
# video_tensor = img_tensor.repeat(1, N_FRAMES, 1, 1, 1)  # check shape

# Run inference
with torch.no_grad():
    vertex_activations = model(img_tensor)  # shape TBD from Step 3
    vertex_activations = vertex_activations.squeeze().cpu().numpy()

# Extract ROI scores using atlas map (from Step 4)
ROI_VERTEX_MAP = { "FFA": [...], "V1_V2": [...], ... }  # hardcoded from atlas
roi_data, mean_top_roi_score = extract_roi_activations(vertex_activations, ROI_VERTEX_MAP)
```

**Keep `MOCK_MODE = True` as a runtime fallback** — don't delete it. Add a `MOCK_MODE`
env var so it can be toggled without redeploy for debugging.

---

## Step 6 — Update heatmap generation (optional but high value)

The current mock heatmap uses Gaussian blobs at fixed spatial priors. Real TRIBE v2
outputs can drive a more accurate spatial heatmap.

**Option A — Gradient-based (GradCAM style)**
- Run inference with `requires_grad=True`
- Backpropagate from the highest-activating ROI
- Use the gradient map as spatial attention
- Project back to image dimensions

**Option B — Feature map visualization**
- Extract intermediate feature maps from the visual encoder
- Average-pool across channels to get a 2D attention map
- Upsample to image resolution

**Option C — Keep the spatial priors approach**
- The current heatmap uses plausible spatial priors (faces center, text top, etc.)
- It will be more accurate with real ROI scores even without spatial backprop
- Lowest-effort upgrade path

**Recommendation:** Start with Option C (just feed real ROI scores into the existing
heatmap generator), then upgrade to Option A if the heatmaps look uninformative.

---

## Step 7 — GPU and timeout tuning

- **GPU:** Start with T4 (currently configured). If inference is too slow, upgrade to A10G.
- **Timeout:** Real TRIBE v2 inference per image is expected to take 5–30s depending on
  model size and GPU. The current `timeout=120` should be sufficient; verify.
- **Cold start:** Loading model weights from the Modal Volume on cold start may take 30–60s.
  Configure `min_containers=1` on the Modal function if cold starts are unacceptable.
- **Batching:** The channel route dispatches 25 sequential jobs. If TRIBE v2 supports
  batch inference (multiple images in one forward pass), add a batch endpoint to process
  all 25 thumbnails in one Modal call — significantly faster and cheaper.

---

## Step 8 — Validate results

Before shipping, sanity-check the model output against known stimuli:

| Input image | Expected high-activation ROI |
|-------------|------------------------------|
| Close-up face photo | FFA (Face Detection) |
| Text-heavy graphic | VWFA (Text Processing) |
| Landscape/scene | PPA (Scene Recognition) |
| High-contrast B&W | V1_V2 (Low-Level Visual Signal) |
| Colorful abstract | V4 (Color and Form Processing) |

If activations don't directionally match these priors, something is wrong with
preprocessing, the vertex map, or the model loading.

---

## Files to Change

| File | Change |
|------|--------|
| `modal/inference.py` | Flip `MOCK_MODE`, add real imports, preprocessing, inference, ROI extraction |
| `modal/inference.py` | Add `ROI_VERTEX_MAP` dict from atlas (Step 4) |
| `modal/inference.py` | Update Modal image to include real deps |
| `src/lib/roi.ts` | Verify ROI keys match what the atlas provides (may need to add/rename) |
| `CLAUDE.md` | Update inference architecture section, mark real inference complete |

**No Next.js changes needed** — the existing polling, correlation, and display pipeline
is model-agnostic. It consumes `roi_data: ROIRegion[]` regardless of how it was produced.

---

## Definition of Done

- [ ] `MOCK_MODE = False` in production Modal deployment
- [ ] A face-heavy thumbnail scores FFA in top 3 ROIs
- [ ] A text-heavy thumbnail scores VWFA in top 3 ROIs
- [ ] @mrbeast correlation run produces directionally sensible results (faces + social cues positive)
- [ ] Inference time per thumbnail < 30s on T4
- [ ] Heatmap visually corresponds to salient regions in the image
