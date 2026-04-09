# Brainiac — Modal GPU Worker

## Setup

1. Install Modal: `pip install modal`
2. Authenticate: `modal token new`
3. Create secret in Modal dashboard named `brainiac-supabase` with:
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
4. Deploy: `modal deploy modal/inference.py`
5. Copy the web endpoint URL from the Modal dashboard
6. Add it to Vercel env vars as `MODAL_INFERENCE_URL`

## How it works

- Next.js API routes POST to the Modal web endpoint with `{ analysis_id, storage_key, supabase_url }`
- The endpoint runs on a T4 GPU, loads TRIBE v2 from HuggingFace (cached in a Modal volume)
- Inference runs → heatmap is generated → both are written back to Supabase
- The analyses row status is updated to `complete`; the Next.js client polls for this

## Model weights

TRIBE v2 weights are downloaded from HuggingFace on first run and cached in the
`brainiac-tribe-weights` Modal volume. Subsequent cold starts reuse the cached weights.

## License

TRIBE v2 is licensed under CC-BY-NC-4.0. See `COMMERCIAL_USE_BLOCKED.md` at repo root.
