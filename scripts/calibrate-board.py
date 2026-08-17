#!/usr/bin/env python3
"""
Калибровка доски: находим на нарисованной картинке сами клетки.

Зачем это существует. Доску целиком рисует GPT Image, значит клетки — пиксели,
а не элементы разметки. Чтобы фишка вставала В клетку, а не рядом, нужно знать
координаты каждой клетки. Размечать их руками — полчаса работы, и всё
насмарку при первой же перерисовке картинки.

Поэтому координаты добываются из самой картинки: скрипт ищет светлые
прямоугольники на фоне полотна, отбирает похожие по размеру, раскладывает их
по периметру в порядке хода и пишет нормированные центры (доли от ширины и
высоты, 0..1) в JSON. Перерисовал доску — прогнал скрипт заново.

Если детектор нашёл не то количество клеток, скрипт НЕ выдумывает: он честно
сообщает, сколько нашёл, и раскладывает ровную сетку по найденной рамке — это
хуже, но предсказуемо и видно в отчёте.

Запуск:
    python3 scripts/calibrate-board.py                 # доска Рутины
    python3 scripts/calibrate-board.py --cells 44 --grid 12
    python3 scripts/calibrate-board.py --debug         # ещё и картинка с разметкой
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, 'public', 'cards')


def load(path):
    im = Image.open(path).convert('RGB')
    return im, np.asarray(im, dtype=np.float32) / 255.0


def find_tiles(arr):
    """
    Клетка — светлая карточка с тонким контуром на фоне полотна.

    Ищем не «светлое» (полотно тоже светлое), а ГРАНИЦЫ: там, где яркость
    резко меняется. Замкнутые области внутри границ и есть клетки.
    """
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    # Градиент яркости: контур клетки даёт всплеск, фактура бумаги — нет.
    gy, gx = np.gradient(lum)
    edge = np.hypot(gx, gy)
    thr = np.percentile(edge, 88)
    walls = edge > thr

    # Заливаем всё, что НЕ граница, и берём компоненты подходящего размера.
    free = ~walls
    lab, n = ndimage.label(free)
    if n == 0:
        return []

    h, w = lum.shape
    total = h * w
    boxes = []
    for sl, idx in zip(ndimage.find_objects(lab), range(1, n + 1)):
        if sl is None:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        bw, bh = x1 - x0, y1 - y0
        area = bw * bh
        if area < total * 0.0008 or area > total * 0.03:
            continue
        ratio = bw / max(1, bh)
        if not (0.55 < ratio < 1.8):          # клетка примерно квадратная
            continue
        fill = (lab[sl] == idx).sum() / area   # компонент должен заполнять свой бокс
        if fill < 0.55:
            continue
        boxes.append((x0, y0, x1, y1))
    return boxes


def dedupe(boxes, min_dist):
    """Один контур может дать два почти одинаковых бокса — оставляем по одному."""
    out = []
    for b in sorted(boxes, key=lambda b: -( (b[2]-b[0]) * (b[3]-b[1]) )):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if all((cx - (o[0]+o[2])/2) ** 2 + (cy - (o[1]+o[3])/2) ** 2 > min_dist ** 2 for o in out):
            out.append(b)
    return out


def order_perimeter(centres, w, h):
    """
    Раскладываем клетки в порядке хода: по часовой стрелке от левого верхнего
    угла. Сортируем по углу относительно центра доски — для кольца это
    надёжнее, чем разбор по сторонам: не спотыкается об угловые клетки.
    """
    cx, cy = w / 2, h / 2
    def key(p):
        ang = np.arctan2(p[1] - cy, p[0] - cx)      # -pi..pi, 0 = вправо
        return (ang + np.pi * 1.25) % (2 * np.pi)   # старт — левый верхний угол
    return sorted(centres, key=key)


def even_grid(n_side, x0, y0, x1, y1):
    """Запасной вариант: ровная сетка по найденной рамке доски."""
    pts = []
    sw, sh = (x1 - x0) / n_side, (y1 - y0) / n_side
    for c in range(n_side):
        pts.append((x0 + sw * (c + 0.5), y0 + sh * 0.5))
    for r in range(1, n_side):
        pts.append((x1 - sw * 0.5, y0 + sh * (r + 0.5)))
    for c in range(n_side - 2, -1, -1):
        pts.append((x0 + sw * (c + 0.5), y1 - sh * 0.5))
    for r in range(n_side - 2, 0, -1):
        pts.append((x0 + sw * 0.5, y0 + sh * (r + 0.5)))
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', default='board-plate-b.webp')
    ap.add_argument('--cells', type=int, default=24, help='сколько клеток на дорожке')
    ap.add_argument('--grid', type=int, default=7, help='сторона сетки для запасного варианта')
    ap.add_argument('--key', default='rat', help='ключ дорожки в JSON')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()

    path = os.path.join(CARDS, a.image)
    if not os.path.exists(path):
        sys.exit(f'нет файла: {path}')

    im, arr = load(path)
    w, h = im.size

    boxes = dedupe(find_tiles(arr), min_dist=w * 0.035)
    centres = [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in boxes]

    # Оставляем только те, что лежат у края: середина доски пустая.
    edge_band = 0.30
    ring = [c for c in centres
            if min(c[0], w - c[0]) < w * edge_band or min(c[1], h - c[1]) < h * edge_band]

    found = len(ring)
    mode = 'детектор'
    if found == a.cells:
        pts = order_perimeter(ring, w, h)
    else:
        mode = 'ровная сетка по рамке'
        if ring:
            xs = [c[0] for c in ring]; ys = [c[1] for c in ring]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        else:
            m = w * 0.075
            x0, y0, x1, y1 = m, m, w - m, h - m
        pts = even_grid(a.grid, x0, y0, x1, y1)

    норм = [{'x': round(x / w, 5), 'y': round(y / h, 5)} for x, y in pts]

    # Средний размер найденной клетки — в долях ширины. По нему интерфейс
    # считает величину значка и зону наведения, чтобы они совпали с рисунком.
    if boxes:
        sizes = [((b[2] - b[0]) / w, (b[3] - b[1]) / h) for b in boxes]
        cell_w = round(float(np.median([s[0] for s in sizes])), 5)
        cell_h = round(float(np.median([s[1] for s in sizes])), 5)
    else:
        cell_w = cell_h = round(1 / a.grid * 0.86, 5)

    out_path = os.path.join(ROOT, 'src', 'data', 'board-cells.json')
    data = {}
    if os.path.exists(out_path):
        data = json.load(open(out_path, encoding='utf-8'))
    data[a.key] = {
        'image': a.image, 'mode': mode, 'found': found,
        'cellW': cell_w, 'cellH': cell_h, 'cells': норм,
    }
    json.dump(data, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print(f'картинка : {a.image} ({w}×{h})')
    print(f'найдено  : {found} клеток у края, нужно {a.cells}')
    print(f'способ   : {mode}')
    print(f'клетка   : {cell_w * 100:.1f}% × {cell_h * 100:.1f}% от полотна')
    print(f'записано : src/data/board-cells.json → ключ «{a.key}», {len(норм)} точек')

    if a.debug:
        dbg = im.copy()
        d = ImageDraw.Draw(dbg)
        for i, (x, y) in enumerate(pts):
            r = w * 0.018
            d.ellipse([x - r, y - r, x + r, y + r], outline=(220, 40, 60), width=3)
            d.text((x - 6, y - 6), str(i), fill=(190, 20, 50))
        p = os.path.join(CARDS, 'debug-' + a.image.replace('.webp', '.png'))
        dbg.save(p)
        print(f'разметка : {p}')


if __name__ == '__main__':
    main()
