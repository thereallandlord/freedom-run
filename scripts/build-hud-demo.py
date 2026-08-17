#!/usr/bin/env python3
"""
Сборка страницы «как стол выглядит в середине партии».

Данные НЕ выдуманные: берутся из src/data/demo-state.json — это выгрузка
живого движка после 20 зарплат (npm run dump:state). Темы — из
src/data/board-themes.json, где палитра посчитана из самих картинок.

Запуск: python3 scripts/build-hud-demo.py
"""
import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = json.load(open(os.path.join(ROOT, 'src/data/demo-state.json'), encoding='utf-8'))
T = json.load(open(os.path.join(ROOT, 'src/data/board-themes.json'), encoding='utf-8'))
ART = json.load(open(os.path.join(ROOT, 'src/data/card-art.json'), encoding='utf-8'))['byId']

RAT = ["opportunity","market","opportunity","doodad","opportunity","charity","opportunity","paycheck",
       "opportunity","market","opportunity","doodad","opportunity","baby","opportunity","paycheck",
       "opportunity","market","opportunity","doodad","opportunity","downsized","opportunity","paycheck"]
META = {
 'opportunity':('Возможность','<rect x="2.5" y="7.5" width="19" height="13" rx="2.2"/><path d="M15.5 20.5V6a2 2 0 0 0-2-2h-3a2 2 0 0 0-2 2v14.5"/>'),
 'market':('Рынок','<path d="M3 20h18"/><path d="M7 16V9M12 16V5M17 16v-4"/>'),
 'doodad':('Трата','<path d="M4.5 8h15l-1.2 12.2a1.6 1.6 0 0 1-1.6 1.3H7.3a1.6 1.6 0 0 1-1.6-1.3z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
 'charity':('Закят','<path d="M12 10.2c1.6-2.4 5.2-1.3 5.2 1.5 0 2.3-3 4.2-5.2 5.8-2.2-1.6-5.2-3.5-5.2-5.8 0-2.8 3.6-3.9 5.2-1.5Z"/><path d="M3.5 20.5h17"/>'),
 'paycheck':('Зарплата','<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>'),
 'baby':('Питомец','<path d="M4.5 9.5 5 4l4 3.2M19.5 9.5 19 4l-4 3.2"/><path d="M12 20.5c-4 0-7-2.7-7-6.1S8 7.5 12 7.5s7 3.5 7 6.9-3 6.1-7 6.1Z"/><path d="M10 13.5h.01M14 13.5h.01"/>'),
 'downsized':('Увольнение','<path d="M3 6.5 10 13l3.5-3.5L21 17"/><path d="M21 12.5V17h-4.5"/>'),
}
COLORS = ['#E14B4B', '#3B82F6', '#16A34A']


def m(n):
    return f'{n:,}'.replace(',', ' ') + ' ₽'


def sg(n):
    return ('+' if n >= 0 else '−') + m(abs(n))


def art(aid):
    """У купленного актива id с хвостом хода — в манифесте ключ без него."""
    return ART.get(aid) or ART.get(re.sub(r'-\d+$', '', aid))


def ring(n=7):
    p = []
    for c in range(n): p.append((0, c))
    for r in range(1, n): p.append((r, n - 1))
    for c in range(n - 2, -1, -1): p.append((n - 1, c))
    for r in range(n - 2, 0, -1): p.append((r, 0))
    return p


CELLS = ring(7)
me = S['места'][0]
goal_done, goal_need = me['пассивный'], me['расходВсего']
pct = min(100, round(goal_done / max(1, goal_need) * 100))


def assets_html(seat):
    out = ''
    for a in seat['недвижимость'] + seat['бизнес']:
        u = art(a['id'])
        pic = f'<img src=".{u}" alt="" loading="lazy">' if u else '<span class="ph"></span>'
        out += (f'<span class="asset">{pic}<span class="an">{html.escape(a["имя"])}</span>'
                f'<span class="av">{sg(a["поток"])}</span></span>')
    return out


def rows_html(seat, keys, src):
    return ''.join(f'<span class="row"><span>{t}</span><b>{m(seat[src][k])}</b></span>'
                   for k, t in keys if seat[src][k])


def screen(key, t):
    cells = ''
    for i, kind in enumerate(RAT):
        r, c = CELLS[i]
        label, d = META[kind]
        toks = ''.join(f'<i style="background:{COLORS[j]}"></i>'
                       for j, s in enumerate(S['места']) if s['позиция'] == i)
        tok = f'<span class="tok">{toks}</span>' if toks else ''
        cells += (f'<div class="cell" data-row="{r+1}" style="grid-row:{r+1};grid-column:{c+1}">'
                  f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" '
                  f'stroke-linecap="round" stroke-linejoin="round">{d}</svg>{tok}'
                  f'<span class="tip">{label}</span></div>')
    chips = ''.join(
        f'<span class="chip{" on" if s["имя"] == S["ходит"] else ""}"><i style="background:{COLORS[j]}"></i>'
        f'{html.escape(s["имя"])}<b>{sg(s["поток"])}</b></span>'
        for j, s in enumerate(S['места']))

    dark = t['dark']
    cellvars = (
        '--cellbg:rgba(12,18,15,.38);--celline:rgba(255,255,255,.26);--cellhi:rgba(12,18,15,.66);'
        '--onaccent:#0B1310;--ring:rgba(255,255,255,.20);--glass:rgba(16,22,19,.66)'
        if dark else
        '--cellbg:rgba(255,255,255,.42);--celline:rgba(20,28,24,.18);--cellhi:rgba(255,255,255,.8);'
        '--onaccent:#FFFFFF;--ring:rgba(255,255,255,.6);--glass:rgba(255,255,255,.78)')
    line = 'rgba(255,255,255,.15)' if dark else 'rgba(20,28,24,.13)'

    return f'''
  <section class="theme" style="--edge:{t['edge']};--panel:{t['panel']};--ink:{t['ink']};
      --muted:{t['muted']};--accent:{t['accent']};--line:{line};{cellvars}">
    <div class="tname">{html.escape(t['name'])}</div>
    <div class="screen">
      <img class="bg" src=".{t['bg']}" alt="" aria-hidden>
      <div class="hud">
        <header class="top">
          <span class="brand"><b>Cashflow</b><em>GreenLeaf</em></span>
          <span class="tbtns">
            <button class="tb">Сделки</button>
            <button class="tb">Финансы</button>
            <button class="tb">Отменить</button>
            <button class="tb">Заново</button>
          </span>
        </header>

        <aside class="side">
          <div class="card who">
            <span class="nm">{html.escape(me['имя'])}</span>
            <span class="pro">{html.escape(me['профессия'])}</span>
          </div>
          <div class="card">
            <span class="k">Цель · выйти из Круга<b class="pct">{pct}%</b></span>
            <span class="v">{m(goal_done)}<em> из {m(goal_need)}</em></span>
            <span class="bar"><i style="width:{max(pct, 2)}%"></i></span>
          </div>
          <div class="card sec in">
            <span class="k">Доходы<b>{m(me['доходВсего'])}</b></span>
            <span class="row"><span>Зарплата</span><b>{m(me['зарплата'])}</b></span>
            <span class="row"><span>Пассивный доход</span><b>{m(me['пассивный'])}</b></span>
          </div>
          <div class="card sec out">
            <span class="k">Расходы<b>{m(me['расходВсего'])}</b></span>
            {rows_html(me, [('жильё','Рассрочка за жильё'),('машина','Рассрочка за машину'),
                            ('карты','Долг за карты'),('техника','Долг за технику'),
                            ('прочее','Прочее')], 'расходы')}
          </div>
          <div class="card sec debt">
            <span class="k">Обязательства</span>
            {rows_html(me, [('машина','Машина'),('карты','Кредитные карты'),
                            ('техника','Техника')], 'обязательства')}
          </div>
          <div class="card sec assets-card">
            <span class="k">Активы<b>{len(me['недвижимость']) + len(me['бизнес'])}</b></span>
            <div class="assets-wrap"><span class="assets">{assets_html(me)}</span></div>
          </div>
        </aside>

        <main class="mid">
          <div class="chips">{chips}<span class="chip mk">Рынок · спокойно</span></div>
          <div class="boardwrap">
            <div class="board">
              <img src=".{t['board']}" alt="" aria-hidden>
              <div class="grid">{cells}</div>
              <div class="centre">
                <span class="w">Ходит</span>
                <span class="n">{html.escape(S['ходит'])}</span>
                <button class="roll">Бросок</button>
              </div>
            </div>
          </div>
        </main>

        <aside class="right">
          <div class="card"><span class="k">Кубики</span><span class="v sm">11</span></div>
          <div class="card"><span class="k">Наличные</span><span class="v sm">{m(me['наличные'])}</span></div>
          <div class="card"><span class="k">Поток в месяц</span><span class="v sm up">{sg(me['поток'])}</span></div>
          <div class="card log"><span class="k">Ход</span>
            {''.join(f'<span class="le">{html.escape(x)}</span>' for x in S['журнал'][-3:])}
          </div>
        </aside>
      </div>
    </div>
  </section>'''


CSS = '''
@font-face{font-family:'Unbounded';font-style:normal;font-weight:700;font-display:swap;
  src:url('./fonts/unbounded-cyrillic-700.woff2') format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;overflow-x:hidden;background:#0C1210;color:#E9F0EB;
  font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1480px;margin:0 auto;padding:28px 16px 80px}
h1{font-family:'Unbounded',system-ui,sans-serif;font-size:24px;letter-spacing:-.025em;margin:0 0 8px}
.lede{margin:0 0 22px;color:#93A99E;max-width:88ch}.lede b{color:#E9F0EB;font-weight:600}
.tname{font-family:'Unbounded',system-ui,sans-serif;font-size:15px;margin:30px 0 10px}

.screen{position:relative;aspect-ratio:16/9;border-radius:18px;overflow:hidden;
  border:1px solid #24332B;box-shadow:0 24px 60px -34px #000;container-type:size}
.screen>.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hud{position:absolute;inset:0;display:grid;gap:1.1cqw;padding:1.2cqw;
  grid-template-columns:21cqw minmax(0,1fr) 14cqw;grid-template-rows:auto minmax(0,1fr);
  color:var(--ink)}
.top{grid-column:1/-1;display:flex;align-items:center;gap:1cqw}
.brand{display:flex;align-items:baseline;gap:.5cqw}
.brand b{font-family:'Unbounded',system-ui,sans-serif;font-size:1.35cqw;letter-spacing:-.03em}
.brand em{font-style:normal;font-size:.72cqw;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent)}
.tbtns{margin-left:auto;display:flex;gap:.45cqw}
.tb{background:var(--glass);border:1px solid var(--line);color:var(--ink);cursor:pointer;
  border-radius:99px;padding:.42cqw 1cqw;font:600 .8cqw/1 inherit;backdrop-filter:blur(10px)}
.tb:hover{border-color:var(--accent)}

/* 🔴 Колонка, а не сетка: у сетки без явных строк подпись и список попадали
   в ОДНУ строку, и «Активы» ложились поверх списка. */
.card{background:var(--glass);border:1px solid var(--line);border-radius:.9cqw;
  padding:.75cqw .85cqw;display:block;min-width:0;backdrop-filter:blur(10px)}
.card>*{display:block}
.card>*+*{margin-top:.24cqw}
.k{font-size:.72cqw;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  display:flex;align-items:baseline;gap:.4cqw}
.k b{margin-left:auto;font-size:.85cqw;color:var(--ink);letter-spacing:0}
.k .pct{color:var(--accent)}
.v{font-family:'Unbounded',system-ui,sans-serif;font-size:1.5cqw;letter-spacing:-.02em}
.v.sm{font-size:1.1cqw}.v.up{color:var(--accent)}
.v em{font-style:normal;font-size:.75cqw;color:var(--muted);font-family:inherit}
.bar{display:block;height:.4cqw;border-radius:99px;background:var(--line);overflow:hidden;margin-top:.3cqw}
.bar i{display:block;height:100%;background:var(--accent);border-radius:99px}
.row{display:flex;justify-content:space-between;gap:.6cqw;font-size:.78cqw;color:var(--muted)}
.row b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.sec{position:relative;padding-left:1.1cqw}
.sec::before{content:'';position:absolute;left:.32cqw;top:.6cqw;bottom:.6cqw;width:.2cqw;border-radius:99px}
.sec.in::before{background:#1F9D6B}.sec.out::before{background:#D6425B}
.sec.debt::before{background:#C98A2E}.sec.assets-card::before{background:#3B82F6}
.who .nm{font-family:'Unbounded',system-ui,sans-serif;font-size:1.15cqw}
.who .pro{font-size:.78cqw;color:var(--muted)}

/* 🔴 Список активов в СВОЕЙ обёртке с прокруткой. Раньше он был прямым
   ребёнком карточки, при нехватке места распирал её и подпись «Активы»
   оказывалась поверх строк. Теперь наезжать физически некуда. */
.assets-wrap{max-height:9cqw;overflow-y:auto}
.assets{display:flex;flex-direction:column;gap:.3cqw;min-width:0}
.asset{display:grid;grid-template-columns:1.5cqw minmax(0,1fr) auto;align-items:center;
  gap:.45cqw;font-size:.75cqw}
.asset img,.asset .ph{width:1.5cqw;height:1.5cqw;border-radius:.3cqw;object-fit:cover;
  border:1px solid var(--line);background:var(--panel)}
.an{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.av{color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}

.side,.right{display:flex;flex-direction:column;gap:.7cqw;min-height:0;overflow-y:auto}
.side>.card{flex:0 0 auto}
.side>.card.assets-card{flex:1 1 auto;min-height:0}
.log{gap:.2cqw}
.le{font-size:.72cqw;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.mid{display:grid;grid-template-rows:auto minmax(0,1fr);gap:.8cqw;min-height:0}
.chips{display:flex;gap:.5cqw;flex-wrap:wrap;align-items:center}
.chip{display:inline-flex;align-items:center;gap:.35cqw;background:var(--glass);
  border:1px solid var(--line);border-radius:99px;padding:.35cqw .8cqw;font-size:.82cqw;
  backdrop-filter:blur(10px)}
.chip i{width:.5cqw;height:.5cqw;border-radius:50%}
.chip b{font-variant-numeric:tabular-nums;color:var(--accent);font-weight:600}
.chip.on{border-color:var(--accent)}.chip.mk{margin-left:auto;color:var(--muted)}

.boardwrap{display:grid;place-items:center;min-height:0}
.board{position:relative;height:min(100%,100cqw);width:auto;aspect-ratio:1;border-radius:1.2cqw;
  border:1px solid var(--line);box-shadow:0 1.2cqw 2.6cqw -1.2cqw rgba(0,0,0,.6)}
.board>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  border-radius:inherit}
.grid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(7,1fr);
  grid-template-rows:repeat(7,1fr);padding:.4cqw}
/* Клетка меньше своей ячейки и полупрозрачная: под ней должен просматриваться
   нарисованный мир, иначе он весь закрыт плашками. */
.cell{position:relative;display:grid;place-items:center;place-self:center;
  width:70%;height:70%;border-radius:.45cqw;background:var(--cellbg);
  border:1px solid var(--celline);color:var(--ink);backdrop-filter:blur(2px);
  transition:transform .15s ease,background .15s ease}
.cell>svg{width:56%;height:56%;opacity:.92}
.cell:hover{transform:scale(1.28);z-index:5;border-color:var(--accent);background:var(--cellhi)}
/* Подсказка над клеткой; у верхнего ряда — под ней, иначе упрётся в фишки. */
.cell .tip{position:absolute;bottom:calc(100% + .35cqw);left:50%;transform:translateX(-50%);
  white-space:nowrap;background:#121815;color:#fff;font-size:.78cqw;font-weight:600;
  padding:.25cqw .5cqw;border-radius:.4cqw;opacity:0;pointer-events:none;
  transition:opacity .15s;z-index:9;box-shadow:0 .3cqw .9cqw -.3cqw rgba(0,0,0,.6)}
.cell[data-row="1"] .tip{bottom:auto;top:calc(100% + .35cqw)}
.cell:hover .tip{opacity:1}
.tok{position:absolute;top:-.42cqw;left:50%;transform:translateX(-50%);display:flex;gap:.18cqw}
.tok i{width:.66cqw;height:.66cqw;border-radius:50%;box-shadow:0 0 0 .14cqw #fff}

.centre{position:absolute;inset:24%;display:grid;place-content:center;justify-items:center;
  text-align:center;pointer-events:none;gap:.45cqw}
.centre .w{font-size:.78cqw;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.centre .n{font-family:'Unbounded',system-ui,sans-serif;font-size:1.7cqw;color:var(--ink)}
/* Кнопка в центре доски, прямо под именем: ближе всего тянуться и не заметить
   её невозможно. */
.roll{border:0;border-radius:99px;background:var(--accent);color:var(--onaccent);cursor:pointer;
  pointer-events:auto;font:700 1.1cqw/1 'Unbounded',ui-sans-serif,system-ui;
  padding:1cqw 2.3cqw;margin-top:.3cqw;
  box-shadow:0 .5cqw 1.4cqw -.4cqw rgba(0,0,0,.55),0 0 0 .26cqw var(--ring);
  transition:transform .12s ease}
.roll:hover{transform:translateY(-1px) scale(1.03)}

@media (max-width:760px){ .screen{aspect-ratio:auto;width:100%;height:82svh} }
@container (max-width: 700px){
  .hud{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;gap:9px;padding:9px}
  .top{flex-wrap:wrap;gap:7px}
  .brand b{font-size:16px}.brand em{font-size:9px}
  .tbtns{gap:5px;width:100%}
  .tb{font-size:11px;padding:7px 11px;flex:1}
  .assets-wrap{max-height:110px}
  .card>*+*{margin-top:3px}
  .side{flex-direction:row;flex-wrap:wrap;order:2;gap:7px;overflow-x:auto}
  .side>.card{flex:1 1 46%;min-width:46%}
  .right{flex-direction:row;flex-wrap:wrap;order:3;gap:7px}
  .right>.card{flex:1 1 30%}
  .mid{order:1;gap:7px}
  .k{font-size:9.5px}.k b{font-size:11px}
  .v{font-size:18px}.v.sm{font-size:14px}.v em{font-size:9.5px}
  .row{font-size:11px}.bar{height:5px}
  .card{border-radius:11px;padding:8px 9px}
  .sec{padding-left:12px}.sec::before{left:4px;width:2.5px;top:8px;bottom:8px}
  .who .nm{font-size:15px}.who .pro{font-size:11px}
  .asset{grid-template-columns:18px minmax(0,1fr) auto;font-size:11px;gap:6px}
  .asset img,.asset .ph{width:18px;height:18px;border-radius:4px}
  .chip{font-size:10.5px;padding:4px 9px;gap:4px}.chip i{width:6px;height:6px}.chip.mk{margin-left:0}
  .log{flex:1 1 100%}.le{font-size:11px}
  .cell{border-radius:6px}.cell .tip{font-size:11px;padding:3px 6px;border-radius:6px}
  .board{border-radius:13px}
  .tok i{width:6.5px;height:6.5px;box-shadow:0 0 0 1.5px #fff}
  .centre .n{font-size:17px}.centre .w{font-size:9px}
  .roll{font-size:14px;padding:11px 22px;min-height:44px}
  .board{border-radius:13px}
}
'''

ORDER = ['leaf', 'mint', 'dusk', 'sand', 'emerald', 'marble', 'ink']
body = '\n'.join(screen(k, T[k]) for k in ORDER if k in T)
n_assets = len(me['недвижимость']) + len(me['бизнес'])

page = (
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<title>Стол · середина партии</title><style>' + CSS + '</style></head><body><div class="wrap">'
    '<h1>Семь фонов на одних и тех же данных</h1>'
    '<p class="lede">Данные <b>настоящие</b>: движок сыграл 20 зарплат ботами. '
    f'Профессия «{html.escape(me["профессия"])}», {n_assets} купленных активов с их потоком, '
    'реальные расходы и обязательства, фишки стоят где стоят. '
    'Клетки стали меньше и полупрозрачными — карта видна под ними. '
    'Кнопка броска переехала в центр, под имя. Наведи на клетку.</p>'
    + body + '</div></body></html>')

out = os.path.join(ROOT, 'public/hud-demo.html')
open(out, 'w', encoding='utf-8').write(page)
print(f'собрано: {len(page)//1024} КБ, тем: {body.count("class=\"theme\"")}')
