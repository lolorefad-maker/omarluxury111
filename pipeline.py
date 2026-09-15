"""
Handbag Catalog Processing & Deduplication Pipeline
===================================================
Produces ONE clean catalogue-style product image per unique bag.
Duplicate shots of the same bag are detected and skipped.
"""

import os
import sys
import gc
import glob
import hashlib
import csv
import argparse
from pathlib import Path
from PIL import Image, ImageFile, ImageFilter, ImageOps, ImageDraw, ImageFont
import numpy as np
import cv2
import imagehash
from tqdm import tqdm
import rembg
import rembg.sessions.base

# Allow truncated WhatsApp JPEG files to load smoothly
ImageFile.LOAD_TRUNCATED_IMAGES = True

import rembg.sessions.dis_general_use

# Zero-copy, in-place float32 normalization to prevent 12MB duplication on Windows CPU
def float32_normalize(self, img, mean, std, size, *args, **kwargs):
    im = img.convert('RGB').resize(size, Image.Resampling.BILINEAR)
    arr = np.asarray(im, dtype=np.float32)
    del im
    # In-place math to eliminate intermediate heap buffers
    arr *= (1.0 / 255.0)
    arr -= np.array(mean, dtype=np.float32)
    arr /= np.array(std, dtype=np.float32)
    arr = np.ascontiguousarray(arr.transpose((2, 0, 1)))
    arr = np.expand_dims(arr, 0)
    return {self.inner_session.get_inputs()[0].name: arr}

rembg.sessions.base.BaseSession.normalize = float32_normalize

# Memory-efficient DisSession predict that frees tensors immediately
def memory_efficient_dis_predict(self, img, *args, **kwargs):
    gc.collect()
    norm_dict = self.normalize(img, (0.5, 0.5, 0.5), (1.0, 1.0, 1.0), (1024, 1024))
    ort_outs = self.inner_session.run(None, norm_dict)
    del norm_dict

    pred = ort_outs[0][:, 0, :, :]
    del ort_outs

    ma = float(np.max(pred))
    mi = float(np.min(pred))
    denom = (ma - mi) if (ma != mi) else 1.0
    pred = (pred - mi) / denom
    pred = np.squeeze(pred)

    mask = Image.fromarray((pred * 255).astype("uint8"), mode="L")
    del pred
    gc.collect()

    if mask.size != img.size:
        mask = mask.resize(img.size, Image.Resampling.BILINEAR)
    return [mask]

rembg.sessions.dis_general_use.DisSession.predict = memory_efficient_dis_predict

# ==========================================
# CONFIGURATION
# ==========================================
DUP_THRESHOLD = 12  # Hamming distance <= 12 on 16x16 pHash (256 bits) groups duplicates
CANVAS_SIZE = 2000
MARGIN_PERCENT = 0.08  # 8% uniform margin on all sides
JPEG_QUALITY = 92
MAX_INFER_DIM = 512  # Optimal 512px inference for lightning-fast high-quality segmentation

DEFAULT_INPUT_DIRS = [
    'bags_raw',
    'WhatsApp Unknown 2026-09-14 at 9.10.06 PM',
    'WhatsApp Unknown 2026-09-14 at 9.10.10 PM',
    'WhatsApp Unknown 2026-09-14 at 9.10.36 PM'
]
DEFAULT_OUTPUT_DIR = './bags_clean'


# ==========================================
# UNION-FIND FOR GROUPING
# ==========================================
class UnionFind:
    def __init__(self, elements):
        self.parent = {e: e for e in elements}
        self.rank = {e: 0 for e in elements}

    def find(self, x):
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, x, y):
        rx = self.find(x)
        ry = self.find(y)
        if rx != ry:
            if self.rank[rx] < self.rank[ry]:
                self.parent[rx] = ry
            elif self.rank[rx] > self.rank[ry]:
                self.parent[ry] = rx
            else:
                self.parent[ry] = rx
                self.rank[rx] += 1
            return True
        return False


# ==========================================
# STEP 0 — SETUP & VERIFY
# ==========================================
def verify_environment():
    print("=" * 60)
    print("STEP 0 — ENVIRONMENT VERIFICATION")
    print("=" * 60)
    print(f"Python: {sys.version.split()[0]}")
    print(f"PIL: {Image.__version__}")
    print(f"OpenCV: {cv2.__version__}")
    print(f"Numpy: {np.__version__}")
    print(f"ImageHash: {imagehash.__version__}")
    print("Setup verified successfully!\n")


# ==========================================
# STEP 1 — INVENTORY
# ==========================================
def run_inventory(input_dirs):
    print("=" * 60)
    print("STEP 1 — INVENTORY SCAN")
    print("=" * 60)

    extensions = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}
    valid_files = []
    seen_paths = set()

    for input_dir in input_dirs:
        p = Path(input_dir)
        if not p.exists():
            continue
        print(f"Scanning directory: {p.resolve()}")

        for root, _, files in os.walk(p):
            for file in files:
                ext = Path(file).suffix.lower()
                if ext in extensions:
                    full_path = Path(root) / file
                    if str(full_path.resolve()) in seen_paths:
                        continue
                    seen_paths.add(str(full_path.resolve()))

                    try:
                        size_bytes = os.path.getsize(full_path)
                        if size_bytes == 0:
                            print(f"[SKIP] Empty file: {full_path}")
                            continue

                        with Image.open(full_path) as im:
                            im.load()
                            w, h = im.size
                            if min(w, h) < 200:
                                print(f"[SKIP] Too small ({w}x{h} < 200px): {full_path.name}")
                                continue

                        # SHA-256 calculation
                        with open(full_path, 'rb') as f:
                            file_bytes = f.read()
                            sha = hashlib.sha256(file_bytes).hexdigest()

                        valid_files.append({
                            'path': full_path,
                            'name': full_path.name,
                            'width': w,
                            'height': h,
                            'size': size_bytes,
                            'sha256': sha,
                            'aspect_ratio': w / h if h != 0 else 1.0
                        })
                    except Exception as err:
                        print(f"[ERROR] Corrupt file {full_path}: {err}")

    # Also scan root directory images if any
    for root_file in glob.glob('*.jpeg') + glob.glob('*.jpg') + glob.glob('*.png'):
        full_path = Path(root_file)
        if str(full_path.resolve()) not in seen_paths:
            seen_paths.add(str(full_path.resolve()))
            try:
                size_bytes = os.path.getsize(full_path)
                with Image.open(full_path) as im:
                    im.load()
                    w, h = im.size
                    if min(w, h) >= 200:
                        with open(full_path, 'rb') as f:
                            sha = hashlib.sha256(f.read()).hexdigest()
                        valid_files.append({
                            'path': full_path,
                            'name': full_path.name,
                            'width': w,
                            'height': h,
                            'size': size_bytes,
                            'sha256': sha,
                            'aspect_ratio': w / h if h != 0 else 1.0
                        })
            except Exception:
                pass

    print(f"Inventory completed: {len(valid_files)} valid candidate images found.\n")
    return valid_files


# ==========================================
# STEP 2 — DEDUPLICATION
# ==========================================
def compute_hashes_and_group(files, threshold=DUP_THRESHOLD):
    print("=" * 60)
    print(f"STEP 2 — DEDUPLICATION (Threshold <= {threshold})")
    print("=" * 60)

    # 1. Compute 16x16 perceptual hash
    print("Computing perceptual hashes (16x16 grayscale)...")
    for f in tqdm(files, desc="pHash calculation"):
        try:
            with Image.open(f['path']) as im:
                im.load()
                im_gray = im.convert('L')
                # 16x16 hash = 256 bits for high-fidelity comparison
                f['phash'] = imagehash.phash(im_gray, hash_size=16)
        except Exception as e:
            f['phash'] = None
            print(f"[ERROR] Hashing failed for {f['path']}: {e}")

    paths = [str(f['path']) for f in files if f.get('phash') is not None]
    uf = UnionFind(paths)
    near_threshold_pairs = []

    # 2. Exact match check (SHA-256)
    sha_map = {}
    for f in files:
        sha = f['sha256']
        p_str = str(f['path'])
        if sha in sha_map:
            uf.union(sha_map[sha], p_str)
        else:
            sha_map[sha] = p_str

    # 3. Pairwise Perceptual Hash comparison
    n = len(files)
    print("Pairwise comparison across images...")
    for i in range(n):
        f1 = files[i]
        p1 = str(f1['path'])
        h1 = f1.get('phash')
        if h1 is None:
            continue

        for j in range(i + 1, n):
            f2 = files[j]
            p2 = str(f2['path'])
            h2 = f2.get('phash')
            if h2 is None:
                continue

            dist = h1 - h2
            if dist <= threshold:
                uf.union(p1, p2)
                # Keep track of boundary cases for QA
                if dist >= threshold - 3:
                    near_threshold_pairs.append({
                        'img1': f1['name'],
                        'img2': f2['name'],
                        'distance': dist
                    })

    # Group into buckets
    groups_dict = {}
    file_by_path = {str(f['path']): f for f in files}
    for p_str in paths:
        root = uf.find(p_str)
        if root not in groups_dict:
            groups_dict[root] = []
        groups_dict[root].append(file_by_path[p_str])

    groups = list(groups_dict.values())
    total_dups = sum(len(g) - 1 for g in groups)
    print(f"Deduplication completed: {len(groups)} unique bags identified ({total_dups} duplicates skipped).\n")
    return groups, near_threshold_pairs


# ==========================================
# STEP 3 — PICK THE BEST IMAGE PER GROUP
# ==========================================
def calculate_sharpness(img_path):
    try:
        pil_img = Image.open(str(img_path))
        pil_img.load()
        pil_img = pil_img.convert('L')
        # Fast downsample for variance if huge
        if max(pil_img.size) > 1200:
            pil_img.thumbnail((1200, 1200), Image.Resampling.BOX)
        arr = np.array(pil_img)
        return float(cv2.Laplacian(arr, cv2.CV_64F).var())
    except Exception:
        return 0.0


def score_image(item):
    w = item['width']
    h = item['height']
    resolution = w * h
    sharpness = calculate_sharpness(item['path'])
    item['sharpness'] = sharpness
    filesize = item['size']

    # Penalise extreme aspect ratio outside 0.5 - 2.0
    ar = item['aspect_ratio']
    penalty = 1.0
    if ar < 0.5 or ar > 2.0:
        penalty = 0.5

    # Formula: resolution * sqrt(sharpness) * (filesize^0.1) * penalty
    score = resolution * (max(sharpness, 1.0) ** 0.5) * (filesize ** 0.1) * penalty
    item['score'] = score
    return score


def select_best_images(groups):
    print("=" * 60)
    print("STEP 3 — PICKING BEST IMAGE PER GROUP")
    print("=" * 60)

    curated_items = []
    for g_idx, group in enumerate(groups, 1):
        for item in group:
            score_image(item)

        # Sort descending by score
        group.sort(key=lambda x: x['score'], reverse=True)
        winner = group[0]
        skipped = group[1:]

        curated_items.append({
            'group_id': f"GRP-{g_idx:03d}",
            'winner': winner,
            'skipped': skipped
        })

    # Sort groups stably by winner filename
    curated_items.sort(key=lambda x: x['winner']['name'])
    print(f"Selection complete: {len(curated_items)} winners selected.\n")
    return curated_items


# ==========================================
# STEP 4 — BUILD CLEAN PRODUCT IMAGES
# ==========================================
def process_clean_image(winner, out_name, out_dir, session):
    jpg_path = out_dir / 'jpg' / f"{out_name}.jpg"
    png_path = out_dir / 'png' / f"{out_name}.png"

    # Idempotency check: if output already exists, skip
    if jpg_path.exists() and png_path.exists():
        return True, "Already existed (skipped re-computation)"

    src_path = winner['path']
    try:
        try:
            with Image.open(src_path) as raw_f:
                raw_img = raw_f.convert('RGB').copy()
        except Exception:
            bgr = cv2.imread(str(src_path))
            if bgr is not None:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                raw_img = Image.fromarray(rgb)
            else:
                raise
        orig_w, orig_h = raw_img.size

        # Inference scale (max 512)
        if max(orig_w, orig_h) > MAX_INFER_DIM:
            scale_down = MAX_INFER_DIM / max(orig_w, orig_h)
            infer_w = max(1, int(orig_w * scale_down))
            infer_h = max(1, int(orig_h * scale_down))
            im_infer = raw_img.resize((infer_w, infer_h), Image.Resampling.BILINEAR)
        else:
            im_infer = raw_img.copy()

        # 1. Background removal via direct predict to minimize peak memory
        masks = session.predict(im_infer)
        alpha_mask = masks[0]
        del im_infer, masks
        gc.collect()

        # Upscale alpha mask back to original dimensions
        alpha_full = alpha_mask.resize((orig_w, orig_h), Image.Resampling.BILINEAR)
        del alpha_mask
        gc.collect()

        raw_img.putalpha(alpha_full)
        del alpha_full
        gc.collect()

        # 2. Trim to alpha bounding box
        bbox = raw_img.getbbox()
        if not bbox:
            bbox = (0, 0, orig_w, orig_h)
        cropped = raw_img.crop(bbox)
        del raw_img
        gc.collect()

        # 3. Canvas & Scaling (uniform 8% margin)
        available = int(CANVAS_SIZE * (1.0 - 2.0 * MARGIN_PERCENT))
        cw, ch = cropped.size
        scale = min(available / cw, available / ch)
        new_w = max(1, int(cw * scale))
        new_h = max(1, int(ch * scale))
        scaled_bag = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
        del cropped
        gc.collect()

        # Crisp unsharp mask
        scaled_bag = scaled_bag.filter(ImageFilter.UnsharpMask(radius=1.5, percent=110, threshold=2))

        # Centering coordinates
        x = (CANVAS_SIZE - new_w) // 2
        y = (CANVAS_SIZE - new_h) // 2

        # --- PNG: Transparent background ---
        png_canvas = Image.new('RGBA', (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        png_canvas.paste(scaled_bag, (x, y), scaled_bag)
        png_canvas.save(png_path, 'PNG', optimize=True)
        del png_canvas
        gc.collect()

        # --- JPG: Pure White (#FFFFFF) + Realistic Contact Shadow ---
        white_canvas = Image.new('RGB', (CANVAS_SIZE, CANVAS_SIZE), (255, 255, 255))
        
        # Soft contact shadow underneath
        sw = int(new_w * 0.75)
        sh = int(new_w * 0.08)
        pad = int(sh * 1.5)
        shadow_patch = Image.new('RGBA', (sw + pad * 2, sh + pad * 2), (0, 0, 0, 0))
        draw = ImageDraw.Draw(shadow_patch)
        draw.ellipse([pad, pad, pad + sw, pad + sh], fill=(40, 35, 30, 80))
        shadow_patch = shadow_patch.filter(ImageFilter.GaussianBlur(radius=int(sh * 0.5)))

        white_canvas.paste(shadow_patch, (x + (new_w - sw)//2 - pad, y + new_h - sh//2 - pad), shadow_patch)
        del shadow_patch

        # Paste product cutout on top
        white_canvas.paste(scaled_bag, (x, y), scaled_bag)
        white_canvas.save(jpg_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        del white_canvas, scaled_bag
        gc.collect()

        return True, "Successfully generated"
    except Exception as err:
        return False, f"Failed: {err}"


# ==========================================
# STEP 5 — BUILD CATALOG & REPORT
# ==========================================
def build_catalog_and_report(curated_items, out_dir):
    print("=" * 60)
    print("STEP 4 & 5 — GENERATING CATALOG PRODUCTS & REPORT")
    print("=" * 60)

    out_p = Path(out_dir)
    jpg_dir = out_p / 'jpg'
    png_dir = out_p / 'png'
    jpg_dir.mkdir(parents=True, exist_ok=True)
    png_dir.mkdir(parents=True, exist_ok=True)

    # Initialize rembg session with isnet-general-use
    print("Initializing rembg model (isnet-general-use)...")
    def create_session():
        gc.collect()
        try:
            return rembg.new_session("isnet-general-use")
        except Exception:
            return rembg.new_session("u2net")

    session = create_session()
    report_rows = []
    written_count = 0
    failure_count = 0

    for idx, item in enumerate(tqdm(curated_items, desc="Processing products"), 1):
        out_name = f"bag-{idx:03d}"
        winner = item['winner']
        skipped = item['skipped']

        # Refresh session every 25 images to clear ONNX CPU cache
        if idx % 25 == 0:
            del session
            gc.collect()
            session = create_session()

        success, note = process_clean_image(winner, out_name, out_p, session)
        if not success and ("allocate" in note or "memory" in note.lower()):
            # Recreate session and retry once
            del session
            gc.collect()
            session = create_session()
            success, note = process_clean_image(winner, out_name, out_p, session)
        if success:
            written_count += 1
        else:
            failure_count += 1
            print(f"[ERROR] {out_name} ({winner['name']}): {note}")

        skipped_names = "|".join(s['name'] for s in skipped)
        report_rows.append({
            'group_id': item['group_id'],
            'output_name': out_name,
            'chosen_source_file': winner['name'],
            'skipped_duplicates': skipped_names if skipped_names else 'NONE',
            'width': winner['width'],
            'height': winner['height'],
            'sharpness_score': round(winner.get('sharpness', 0.0), 2),
            'notes': note
        })

    # Write CSV Report
    report_csv = out_p / 'report.csv'
    fieldnames = ['group_id', 'output_name', 'chosen_source_file', 'skipped_duplicates', 'width', 'height', 'sharpness_score', 'notes']
    with open(report_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report_rows)

    print(f"Report written to: {report_csv}")
    return report_rows, written_count, failure_count


# ==========================================
# STEP 6 — QA & CONTACT SHEET
# ==========================================
def generate_contact_sheet(report_rows, out_dir, near_threshold_pairs):
    print("=" * 60)
    print("STEP 6 — QA & CONTACT SHEET GENERATION")
    print("=" * 60)

    out_p = Path(out_dir)
    jpg_dir = out_p / 'jpg'

    valid_images = []
    for r in report_rows:
        img_file = jpg_dir / f"{r['output_name']}.jpg"
        if img_file.exists():
            valid_images.append((r['output_name'], img_file))

    if not valid_images:
        print("[WARN] No generated images available for contact sheet.")
        return

    # Thumbnails setup: 6 columns
    COLS = 6
    THUMB_SIZE = 320
    LABEL_HEIGHT = 36
    CELL_H = THUMB_SIZE + LABEL_HEIGHT
    rows = (len(valid_images) + COLS - 1) // COLS

    sheet_w = COLS * THUMB_SIZE
    sheet_h = rows * CELL_H
    sheet = Image.new('RGB', (sheet_w, sheet_h), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)

    for idx, (name, path) in enumerate(valid_images):
        col = idx % COLS
        row = idx // COLS
        x0 = col * THUMB_SIZE
        y0 = row * CELL_H

        try:
            with Image.open(path) as im:
                im_thumb = im.resize((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
                sheet.paste(im_thumb, (x0, y0))

            # Draw light border and label
            draw.rectangle([x0, y0, x0 + THUMB_SIZE, y0 + CELL_H], outline=(225, 220, 215))
            draw.rectangle([x0, y0 + THUMB_SIZE, x0 + THUMB_SIZE, y0 + CELL_H], fill=(245, 243, 240))
            draw.text((x0 + 14, y0 + THUMB_SIZE + 10), name, fill=(20, 20, 20))
        except Exception as e:
            print(f"[ERROR] Adding {name} to contact sheet: {e}")

    contact_path = out_p / 'contact_sheet.jpg'
    sheet.save(contact_path, 'JPEG', quality=88, optimize=True)
    print(f"Contact sheet generated: {contact_path} ({sheet_w}x{sheet_h})")

    # QA Review: Near threshold items
    print("\n--- QA CONFIDENCE REVIEW ---")
    if near_threshold_pairs:
        print(f"The following {len(near_threshold_pairs)} pairs had perceptual distances close to threshold ({DUP_THRESHOLD}):")
        for p in near_threshold_pairs[:10]:
            print(f"  • {p['img1']} <-> {p['img2']} (Hamming distance: {p['distance']})")
    else:
        print("All grouped pairs had strong confidence separation well within threshold.")
    print("=" * 60)


# ==========================================
# MAIN RUNNER
# ==========================================
def main():
    parser = argparse.ArgumentParser(description="Handbag Catalog Product Pipeline")
    parser.add_argument('--input', nargs='*', default=DEFAULT_INPUT_DIRS, help="Input directories")
    parser.add_argument('--output', default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument('--threshold', type=int, default=DUP_THRESHOLD, help="Deduplication threshold")
    args = parser.parse_args()

    verify_environment()

    # Step 1: Inventory
    valid_files = run_inventory(args.input)
    if not valid_files:
        print("[ERROR] No valid images found to process. Exiting.")
        return

    # Step 2: Deduplication
    groups, near_threshold_pairs = compute_hashes_and_group(valid_files, threshold=args.threshold)

    # Step 3: Best Image per Group
    curated_items = select_best_images(groups)

    # Step 4 & 5: Clean Product Images & Report
    report_rows, written_count, failure_count = build_catalog_and_report(curated_items, args.output)

    # Step 6: QA Contact Sheet
    generate_contact_sheet(report_rows, args.output, near_threshold_pairs)

    # Final Summary
    total_inputs = len(valid_files)
    unique_bags = len(curated_items)
    dups_skipped = total_inputs - unique_bags

    print("\n" + "#" * 60)
    print("             PIPELINE EXECUTION SUMMARY")
    print("#" * 60)
    print(f"Total Input Images Scanned : {total_inputs}")
    print(f"Unique Handbags Found      : {unique_bags}")
    print(f"Duplicates Skipped         : {dups_skipped}")
    print(f"Output Images Written      : {written_count}")
    print(f"Failures / Errors          : {failure_count}")
    print(f"Output Directory           : {Path(args.output).resolve()}")
    print(f"Report CSV                 : {Path(args.output, 'report.csv').resolve()}")
    print(f"Contact Sheet              : {Path(args.output, 'contact_sheet.jpg').resolve()}")
    print("#" * 60 + "\n")


if __name__ == '__main__':
    main()
