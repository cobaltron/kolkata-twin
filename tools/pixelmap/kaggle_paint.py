"""
Stage 3 of the generated pixel map: repaint the block render as isometric pixel art on a Kaggle GPU.
Pushed and run by tools/pixelmap/kaggle.mjs; it is not meant to run on your own machine.

Model: FLUX.2 [klein] 4B (Apache 2.0) with the Isometric Mumbai style LoRA (Flash1405/isometric-mumbai,
Apache 2.0). Seam-free schedule and infill-template format follow flash1405/isometric-mumbai and
cannoneyed/isometric-nyc (both MIT): the map is a grid of 512 px quadrants painted in four phases, so
that every tile after the first phase is painted with finished art on both sides of it.

  phase 1  2x2 blocks at every third quadrant         nothing to match yet
  phase 2  the one-quadrant vertical gaps between them  finished art left and right
  phase 3  the one-quadrant horizontal gaps             finished art above and below
  phase 4  the gap intersections                        finished art on all four sides
"""
import glob, os, subprocess, sys, time

os.environ["HF_HOME"] = "/tmp/hf"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "git+https://github.com/huggingface/diffusers.git", "peft"], check=True)
# Kaggle ships an old torchao that makes peft refuse to load any LoRA; nothing here needs it.
subprocess.run([sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao"], check=False)

import torch
from PIL import Image, ImageDraw
from accelerate.hooks import AlignDevicesHook, add_hook_to_module
from diffusers import Flux2KleinPipeline

Image.MAX_IMAGE_PIXELS = None
T, Q = 1024, 512
PROMPT = ("Fill in the outlined section with the missing pixels corresponding to the <isometric nyc pixel art> style, "
          "removing the border and exactly following the shape/style/structure of the surrounding image (if present).")
OUT = "/kaggle/working"

render_path = glob.glob("/kaggle/input/**/render.png", recursive=True)[0]
render = Image.open(render_path).convert("RGB")
cols, rows = render.width // Q, render.height // Q
assert cols % 3 == 2 and rows % 3 == 2, "cols and rows must be 2 mod 3 (8, 11, 14, ...)"
print(f"render {render.size}, {cols} x {rows} quadrants", flush=True)

# fp16 with the transformer alone on GPU 1: the only layout that fits a 15 GB T4 (bf16 runs out of memory).
pipe = Flux2KleinPipeline.from_pretrained("black-forest-labs/FLUX.2-klein-4B", torch_dtype=torch.float16)
pipe.load_lora_weights("Flash1405/isometric-mumbai", weight_name="isometric-mumbai-klein-v2.safetensors")
pipe.text_encoder.to("cuda:0"); pipe.vae.to("cuda:0"); pipe.transformer.to("cuda:1")
add_hook_to_module(pipe.transformer, AlignDevicesHook(execution_device="cuda:1", io_same_device=True))
pipe.vae.enable_tiling()

def plan():
    """{phase: [(window_x, window_y, (x0, y0, x1, y1))]}: the 1024 px window and the box to paint inside it."""
    bxs, bys = range(0, cols, 3), range(0, rows, 3)
    gxs, gys = range(2, cols, 3), range(2, rows, 3)
    h = Q // 2
    return {
        1: [(bx * Q, by * Q, (0, 0, T, T)) for by in bys for bx in bxs],
        2: [(gx * Q - h, by * Q, (h, 0, h + Q, T)) for by in bys for gx in gxs],
        3: [(bx * Q, gy * Q - h, (0, h, T, h + Q)) for gy in gys for bx in bxs],
        4: [(gx * Q - h, gy * Q - h, (h, h, h + Q, h + Q)) for gy in gys for gx in gxs],
    }

def template(gen, wx, wy, box):
    """Finished art as context, with the raw render inside a 2 px red box marking what to paint."""
    t = gen.crop((wx, wy, wx + T, wy + T))
    x0, y0, x1, y1 = box
    t.paste(render.crop((wx + x0, wy + y0, wx + x1, wy + y1)), (x0, y0))
    d = ImageDraw.Draw(t)
    for i in range(2):
        d.rectangle([x0 + i, y0 + i, x1 - 1 - i, y1 - 1 - i], outline=(255, 0, 0))
    return t

def clean_border(img, box, band=3):
    """The model can leave a faint line where the red box was: rebuild that band from the pixels just inside."""
    import numpy as np
    a = np.asarray(img).copy()
    x0, y0, x1, y1 = box
    a[y0:y0 + band, x0:x1] = a[y0 + band, x0:x1]
    a[y1 - band:y1, x0:x1] = a[y1 - band - 1, x0:x1]
    a[y0:y1, x0:x0 + band] = a[y0:y1, x0 + band][:, None]
    a[y0:y1, x1 - band:x1] = a[y0:y1, x1 - band - 1][:, None]
    return Image.fromarray(a)

gen = Image.new("RGB", render.size)
t0, n = time.time(), 0
total = sum(len(v) for v in plan().values())
for phase, jobs in plan().items():
    for wx, wy, box in jobs:
        out = pipe(image=template(gen, wx, wy, box), prompt=PROMPT, num_inference_steps=4, guidance_scale=1.0, height=T, width=T,
                   generator=torch.Generator("cpu").manual_seed(7 + wx * 7 + wy * 13)).images[0]
        if out.size != (T, T):
            out = out.resize((T, T), Image.Resampling.LANCZOS)
        x0, y0, x1, y1 = box
        gen.paste(clean_border(out, box).crop(box), (wx + x0, wy + y0))
        n += 1
        if n % 5 == 0 or n == total:
            print(f"phase {phase}: {n}/{total} tiles, {(time.time() - t0) / n:.1f} s/tile", flush=True)
    gen.save(f"{OUT}/generated.png")  # a finished phase is kept even if a later one fails
gen.save(f"{OUT}/generated.jpg", quality=95)
print(f"done: {total} tiles in {(time.time() - t0) / 60:.1f} min", flush=True)
