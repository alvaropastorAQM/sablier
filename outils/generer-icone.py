#!/usr/bin/env python3
"""Generates the Sablier icon (src-tauri/icons/icon.png at 1024 px, then icon.icns).

Same spirit as the Project A icon: deep navy rounded square, thin rings,
glowing motif in the centre. Here the motif is an hourglass whose sand is
gold (the precious colour of the brand palette). Drawn at 4096 px then
scaled down to 1024 px for clean smoothing. Dependencies: Pillow,
iconutil (macOS).
"""
import os, subprocess, shutil, math
from PIL import Image, ImageDraw, ImageFilter

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
S = 4  # supersampling factor
N = 1024 * S

def rgba(hexa, a=255):
    hexa = hexa.lstrip('#')
    return tuple(int(hexa[i:i+2], 16) for i in (0, 2, 4)) + (a,)

MARINE_HAUT = rgba('#16324F')
MARINE_BAS = rgba('#0A1A2E')
BLEU = rgba('#2E5B90')
BLEU_CLAIR = rgba('#8FB4E3')
BLANC = rgba('#F5F8FB')
OR = rgba('#C9A961')
OR_FONCE = rgba('#A5813C')

img = Image.new('RGBA', (N, N), (0, 0, 0, 0))

# --- Rounded square with vertical gradient ---------------------------
marge = 100 * S
taille = N - 2 * marge
rayon = 185 * S
degrade = Image.new('RGBA', (N, N), (0, 0, 0, 0))
dd = ImageDraw.Draw(degrade)
for y in range(marge, N - marge):
    t = (y - marge) / taille
    c = tuple(int(MARINE_HAUT[i] * (1 - t) + MARINE_BAS[i] * t) for i in range(3)) + (255,)
    dd.line([(marge, y), (N - marge, y)], fill=c)
masque = Image.new('L', (N, N), 0)
ImageDraw.Draw(masque).rounded_rectangle([marge, marge, N - marge, N - marge], radius=rayon, fill=255)
img.paste(degrade, (0, 0), masque)

# Subtle outline on the edge of the square.
bord = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(bord).rounded_rectangle([marge, marge, N - marge, N - marge], radius=rayon, outline=(255, 255, 255, 34), width=3 * S)
img = Image.alpha_composite(img, bord)

# --- Blue halo in the centre (like the glowing disc of the X) --------
halo = Image.new('RGBA', (N, N), (0, 0, 0, 0))
hd = ImageDraw.Draw(halo)
cx = cy = N // 2
for r, a in ((300 * S, 40), (220 * S, 55), (150 * S, 70)):
    hd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(31, 73, 125, a))
halo = halo.filter(ImageFilter.GaussianBlur(70 * S))
img = Image.alpha_composite(img, halo)

# --- Thin rings, some of them dotted ---------------------------------
anneaux = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ad = ImageDraw.Draw(anneaux)
def arc(r, a0, a1, couleur, largeur, pointille=False):
    box = [cx - r, cy - r, cx + r, cy + r]
    if not pointille:
        ad.arc(box, a0, a1, fill=couleur, width=largeur)
    else:
        a = a0
        while a < a1:
            ad.arc(box, a, min(a + 2.2, a1), fill=couleur, width=largeur)
            a += 5.5
arc(330 * S, 200, 330, (66, 114, 164, 150), 4 * S)
arc(330 * S, 20, 120, (66, 114, 164, 110), 4 * S)
arc(300 * S, 120, 190, (98, 137, 180, 90), 3 * S, pointille=True)
arc(300 * S, 300, 400, (98, 137, 180, 90), 3 * S, pointille=True)
arc(262 * S, 220, 300, (98, 137, 180, 120), 3 * S)
arc(262 * S, 40, 90, (98, 137, 180, 120), 3 * S)
arc(236 * S, 340, 30, (143, 180, 227, 80), 2 * S, pointille=True)
arc(236 * S, 150, 210, (143, 180, 227, 80), 2 * S, pointille=True)
img = Image.alpha_composite(img, anneaux)

# --- The hourglass ---------------------------------------------------
# Coordinates in 1024 space (multiplied by S when drawing).
def P(x, y):
    return (x * S, y * S)

haut, bas = 300, 724
g, d = 380, 644          # left / right of the bulbs
neck_g, neck_d = 499, 525
neck_y_h, neck_y_b = 500, 524
cap_g, cap_d = 356, 668

def tracer_sablier(dr, couleur, largeur):
    # Top and bottom caps
    dr.line([P(cap_g, haut), P(cap_d, haut)], fill=couleur, width=largeur, joint='curve')
    dr.line([P(cap_g, bas), P(cap_d, bas)], fill=couleur, width=largeur, joint='curve')
    # Upper bulb
    dr.line([P(g, haut), P(neck_g, neck_y_h), P(neck_d, neck_y_h), P(d, haut)], fill=couleur, width=largeur, joint='curve')
    # Lower bulb
    dr.line([P(g, bas), P(neck_g, neck_y_b), P(neck_d, neck_y_b), P(d, bas)], fill=couleur, width=largeur, joint='curve')
    # Rounded ends
    r = largeur / 2
    for (x, y) in ((cap_g, haut), (cap_d, haut), (cap_g, bas), (cap_d, bas)):
        dr.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=couleur)

# Blue glow under the stroke
lueur = Image.new('RGBA', (N, N), (0, 0, 0, 0))
tracer_sablier(ImageDraw.Draw(lueur), (120, 170, 230, 210), 30 * S)
lueur = lueur.filter(ImageFilter.GaussianBlur(18 * S))
img = Image.alpha_composite(img, lueur)

# Sand: lower mound, remaining upper part, trickle flowing down (gold)
sable = Image.new('RGBA', (N, N), (0, 0, 0, 0))
sd = ImageDraw.Draw(sable)
sd.polygon([P(402, bas - 2), P(622, bas - 2), P(512, 606)], fill=OR)
sd.polygon([P(462, 462), P(562, 462), P(512, neck_y_h)], fill=OR)
sd.line([P(512, neck_y_b), P(512, 640)], fill=OR, width=5 * S)
# Soft highlight on the sand
reflet = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(reflet).polygon([P(402, bas - 2), P(622, bas - 2), P(512, 606)], fill=(255, 235, 190, 90))
reflet = reflet.filter(ImageFilter.GaussianBlur(10 * S))
img = Image.alpha_composite(img, sable)
img = Image.alpha_composite(img, reflet)

# Main stroke of the hourglass, slightly bluish white
trait = Image.new('RGBA', (N, N), (0, 0, 0, 0))
tracer_sablier(ImageDraw.Draw(trait), BLANC, 15 * S)
img = Image.alpha_composite(img, trait)

# Glowing dot at the neck
point = Image.new('RGBA', (N, N), (0, 0, 0, 0))
pd = ImageDraw.Draw(point)
r = 26 * S
pd.ellipse([cx - r, 512 * S - r, cx + r, 512 * S + r], fill=(200, 225, 255, 120))
point = point.filter(ImageFilter.GaussianBlur(12 * S))
img = Image.alpha_composite(img, point)

# Light drop shadow of the square, under everything
ombre = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(ombre).rounded_rectangle([marge, marge + 14 * S, N - marge, N - marge + 14 * S], radius=rayon, fill=(0, 0, 0, 110))
ombre = ombre.filter(ImageFilter.GaussianBlur(22 * S))
final = Image.alpha_composite(ombre, img)

final = final.resize((1024, 1024), Image.LANCZOS)
chemin_png = os.path.join(RACINE, 'src-tauri', 'icons', 'icon.png')
final.save(chemin_png)
print('written', chemin_png)

# --- .icns via iconutil ------------------------------------------------
iconset = os.path.join(RACINE, 'src-tauri', 'icons', 'icon.iconset')
shutil.rmtree(iconset, ignore_errors=True)
os.makedirs(iconset)
for taille in (16, 32, 128, 256, 512):
    for echelle in (1, 2):
        px = taille * echelle
        nom = 'icon_%dx%d%s.png' % (taille, taille, '@2x' if echelle == 2 else '')
        final.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, nom))
icns = os.path.join(RACINE, 'src-tauri', 'icons', 'icon.icns')
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
shutil.rmtree(iconset, ignore_errors=True)
print('written', icns, os.path.getsize(icns), 'bytes')
