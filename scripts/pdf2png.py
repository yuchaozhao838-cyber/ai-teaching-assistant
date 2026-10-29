import sys
import os
import pypdfium2 as pdfium

src = sys.argv[1]
outdir = sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.6
os.makedirs(outdir, exist_ok=True)
pdf = pdfium.PdfDocument(src)
for i in range(len(pdf)):
    page = pdf[i]
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()
    image.save(os.path.join(outdir, f"page-{i+1:02d}.png"))
print(f"rendered {len(pdf)} pages to {outdir}")
