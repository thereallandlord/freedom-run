#!/usr/bin/env node
/**
 * Иллюстрации к карточкам игры: генерация через gpt-image-2 + сжатие в webp.
 *
 * Почему так, а не «промпт из title+flavor»: модель на абстрактной метафоре
 * («дерево с кружочками» для партнёрского бизнеса) выдаёт сток. Поэтому под
 * каждую карточку здесь лежит КОНКРЕТНАЯ СЦЕНА на английском — что именно в
 * кадре, где и при каком свете. Русские тексты в промпт не идут вовсе: модель
 * от них норовит нарисовать кириллицу на вывесках.
 *
 * Запуск:
 *   node scripts/gen-illustrations.mjs                 # всё, чего ещё нет
 *   node scripts/gen-illustrations.mjs --dry           # только список работ
 *   node scripts/gen-illustrations.mjs --only=dd-      # префикс ключа
 *   node scripts/gen-illustrations.mjs --limit=5       # первые N
 *   node scripts/gen-illustrations.mjs --force         # перерисовать поверх
 *   node scripts/gen-illustrations.mjs --concurrency=8
 *
 * Ключ: переменная OPENAI_API_KEY либо вытягивается из Railway (craft-ai).
 * В вывод ключ не попадает никогда.
 */

import { execSync, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'public', 'cards')
const DECKS = path.join(ROOT, 'src', 'data', 'decks_ru.json')

const MODEL = 'gpt-image-2'
const QUALITY = 'low'
const SIZE = '1536x1024'
// Доска — квадрат: в альбомном кадре её пришлось бы обрезать, а обрезка
// съедает рамку и ломает калибровку клеток.
const SIZE_SQUARE = '1024x1024'

// Стиль полотна. Общий STYLE просит живописную сцену в горизонтальном кадре —
// для доски это вредно: нужна плоская печатная поверхность без сюжета.
const BOARD_STYLE = [
  'Flat top-down product photograph of printed board game cardboard, shot straight from above,',
  'centred and filling the frame. Even soft studio light, no cast shadows,',
  'no perspective, no tilt. Calm minimalist print design, muted warm palette.',
  'No text, no letters, no numbers, no logos, no watermarks.',
].join(' ')
const RUB_PER_IMAGE = 0.37 // замер по факту: low ≈ 158 output-токенов × $30/1M × ~78 ₽/$

const TARGET_WIDTH = 900
const TARGET_WIDTH_BOARD = 1024
const WEBP_QUALITY = 78

// 🔴 У организации лимит gpt-image-2 = 5 картинок в минуту. Без троттлинга пачка
// из восьми потоков ловит 429 на каждой второй карточке и выгорает на ретраях.
// Держим бюджет сами: не больше RPM стартов за скользящую минуту.
const RPM_DEFAULT = 5

// ─────────────────────────────────────────────────────────────────────────────
// Стиль. Утверждён владельцем: «чуть больше реализма», без символов и текста.
// ─────────────────────────────────────────────────────────────────────────────
const STYLE = [
  'Semi-realistic illustration, leaning realistic: accurate real-world architecture,',
  'materials and proportions, photographic composition and lighting, but rendered with',
  'clean painterly shading and slightly simplified detail — like a high-end travel',
  'magazine illustration. Warm natural daylight, soft shadows, airy light background,',
  'muted natural palette with fresh green accents. Premium and calm.',
  'Wide horizontal 3:2 composition with room to breathe.',
  'No text, no letters, no numbers, no signage, no logos, no watermarks.',
].join(' ')

// ─────────────────────────────────────────────────────────────────────────────
// СЦЕНЫ. Ключ = id карточки (или stock-<тикер> / dream-<слаг>).
// ─────────────────────────────────────────────────────────────────────────────

/** Малые сделки — недвижимость Уфа / Казань / Челны. */
const SCENES_SMALL_RE = {
  "sd-dxb-jvc":
    "A compact modern studio apartment in Jumeirah Village Circle, Dubai: pale wood floor, built-in kitchenette, floor-to-ceiling window with a view of low-rise beige residential towers and palm-lined streets, bright desert daylight",
  "sd-dxb-arjan":
    "A newly finished Dubai studio in Arjan district, warm neutral interior, sliding balcony door open onto a green landscaped courtyard with flowering pergolas, late afternoon sun",
  "sd-dxb-south":
    "A one-bedroom apartment in Dubai South near the new airport: minimalist interior, wide balcony overlooking a district still under construction with cranes on the horizon, clear blue sky",
  "sd-dxb-bay":
    "A polished studio apartment in Business Bay, Dubai, with a panoramic window onto the water canal and glass towers, evening light, city reflections on the floor",
  "sd-dxb-jvt":
    "A family one-bedroom in a low-rise Dubai neighbourhood: private garden terrace, outdoor table, children bicycles by the wall, palm shade, soft morning light",
  "sd-dxb-dso-trap":
    "An unfinished concrete apartment shell in a distant Dubai suburb: bare walls, dust, exposed wiring, a glossy marketing render board propped against the window showing a building that does not exist yet, harsh midday sun and empty sand beyond",
  "sd-tur-mersin":
    "A modest one-bedroom apartment on the Mersin coast of Turkey: white walls, tiled floor, balcony with drying laundry, palm trees and the Mediterranean visible between low buildings, bright sun",
  "sd-tur-mahmutlar":
    "A resale apartment in Mahmutlar, Alanya: simple furnished living room, balcony overlooking a residential complex swimming pool surrounded by loungers and pines, warm afternoon",
  "sd-tur-konyaalti":
    "A two-bedroom family flat in Konyaalti, Antalya: lived-in interior, bookshelf, balcony with a view of the Taurus mountains meeting the sea, clear day",
  "sd-tur-lara":
    "A short-let holiday apartment in Lara, Antalya: crisp white bedding, suitcase open on a rack, balcony over a hotel strip and the beach, strong summer light",
  "sd-tur-istanbul":
    "A two-bedroom apartment in a dense Istanbul suburb on the European side: modern block interior, window onto rows of residential towers and a metrobus road, hazy daylight",
  "sd-tur-fethiye":
    "A three-bedroom house with its own garden near Fethiye, Turkey: fig tree in the yard, stone terrace with a table, pine hills and a sliver of sea behind, golden hour",
  "sd-tur-bodrum":
    "A compact holiday studio in Gumbet, Bodrum: whitewashed walls, blue shutters, bougainvillea on the terrace, Aegean bay in the distance, midday brightness",
  "sd-tur-trap":
    "A stalled construction site in Alanya, Turkey: half-built concrete frame, rusting rebar, silent idle crane, faded developer banner sagging on the fence, overcast light and weeds growing through gravel",
  "sd-park-ufa":
    "A warm underground parking space in a Russian residential complex: clean painted floor markings, one empty numbered bay, concrete columns, fluorescent light, a car covered in melting snow nearby",
  "sd-park-kzn":
    "A modern underground parking level under a new Kazan residential building: bright LED strips, glossy sealed floor, numbered bays, a security camera on the column",
  "sd-park-chelny":
    "A simple covered parking bay in a provincial Russian town: corrugated roof, gravel surface, numbered marking, birch trees and panel houses beyond the fence, grey daylight",
  "sd-store-kzn":
    "A small basement storage unit in a Russian apartment complex: mesh partition walls, a bicycle, winter tyres stacked, plastic boxes and a folded artificial Christmas tree, bare bulb light",
  "sd-store-ufa":
    "A tidy new storage room in a freshly built Russian residential block: clean concrete floor, metal mesh door with a padlock, a few sealed cardboard boxes, cool overhead light",
  "sd-land-tukay":
    "An empty plot of rural land near Naberezhnye Chelny, Russia: flat grass field with survey stakes and a boundary marker, distant treeline, wide overcast sky",
  "sd-land-iglino":
    "An empty suburban land plot near Ufa with wooden corner posts and mown grass, a gravel access track, birch forest on one side, soft spring light",
  "sd-land-laishevo":
    "A vacant land plot near the Kama river outside Kazan: tall grass, surveyor pegs, a neighbouring plot with a half-built cottage, wide horizon, late afternoon",
  "sd-land-m12":
    "An empty commercial land plot beside a new Russian federal motorway exit: fresh asphalt ramp, road signs, flat field with boundary markers, trucks passing in the distance",
  "sd-room-ufa":
    "A single small rented room in a 1960s Soviet panel block in Ufa: narrow bed, desk with textbooks, old wardrobe, lace curtain, grey panel houses outside, warm afternoon",
  "sd-shib":
    "A phone showing a wildly spiking then crashing candlestick chart of a joke cryptocurrency, lying on a cluttered desk in a dim room lit by monitor glow",
  "sd-pepe":
    "A dark desk with two monitors showing a volatile crypto chart and a busy chat window scrolling with messages, night lighting",
  "sd-newmeme":
    "A brand new cryptocurrency launch page open on a laptop in a dark room, countdown timer and anonymous avatars, monitor glow on the desk",

  'sd-room-ufa-chernikovka':
    'A single small rented room of about 13 square metres inside a 1960s Soviet panel apartment block in a Russian industrial city: a narrow bed, a desk piled with student textbooks, an old wardrobe, lace curtain half drawn; grey panel houses and birch trees outside the window, warm afternoon light',
  'sd-room-ufa-sipailovo':
    'A modest 18 square metre room with dated 1980s Soviet wallpaper, a patterned rug hung on the wall, a folding sofa and a sideboard with porcelain cups; the window looks into a green courtyard of panel high-rises, soft overcast daylight',
  'sd-studio-ufa-dema':
    'A brand new empty studio apartment in a freshly finished Russian residential block: bare plaster walls, a screed floor, one large window; construction cranes and half-built towers outside, low winter afternoon sun',
  'sd-studio-ufa-inors':
    'A small freshly renovated studio apartment in a modern Russian high-rise: glossy laminate floor, a compact kitchen unit, no furniture yet, a wide window overlooking a new residential district, bright even daylight',
  'sd-room-kzn-aviastroit':
    'A plain rented room in a worker dormitory building near a Russian aircraft factory: two neat single beds, work jackets on wall hooks, boots by the door; factory chimneys and a metro pavilion visible through the window at dusk',
  'sd-room-kzn-derbyshki':
    'A tiny 12 square metre room in an old low-rise Soviet house surrounded by tall pines: simple bed, a small table, a bookshelf; sunbeams filtering through pine branches into a quiet green suburb',
  'sd-studio-kzn-salavat-kupere':
    'A courtyard ringed by many identical colourful new Russian apartment towers, hundreds of identical windows, a few parked cars, one window lit; flat bright overcast light, a feeling of too many identical flats at once',
  'sd-studio-kzn-azino':
    'A neat small studio apartment of a young programmer: a desk with two monitors showing abstract colour gradients, an ergonomic chair, a plant, a tidy bed in the corner, tidy cables; a wide window with a Russian city district view, calm daylight',
  'sd-room-chelny-ges':
    'A very cheap bare room in an old Soviet block near a hydroelectric dam: peeling paint, a bare bulb, an iron bed frame, a suitcase by the door; the concrete dam and a wide river through the window, cool grey light',
  'sd-studio-chelny-zyab':
    'A compact studio apartment in a Soviet-era panel district of a Russian truck-factory town: simple furniture, work boots by the door, a thermos on the table; the vast plant with smokestacks on the horizon, cold clear daylight',
  'sd-room-chelny-rodnya':
    'A lived-in rented room: unmade bed, dishes left on the table, slippers, a jacket thrown over a chair, an envelope on the windowsill; warm familial disorder, soft afternoon light',
  'sd-studio-ufa-zaton':
    'A new residential district on the bank of a wide river with a brand-new road bridge in the background, a modern apartment tower in the foreground, tower cranes still working, fresh spring daylight',
  'sd-room-ufa-center':
    'A room in a pre-revolutionary Russian townhouse in a city centre: three-metre ceilings, a tall old window with a deep sill, stucco cornice, herringbone parquet, an upright piano against the wall, golden afternoon light',
  'sd-apt-kzn-kirovsky':
    'A modest one-room apartment in an older Russian city district: a small kitchen with a table by the window, patterned tile floor, a kettle on the stove; an old tram passing outside, warm evening light',
  'sd-apt-kzn-yudino':
    'A small one-room apartment near a suburban railway station: cardboard moving boxes, a young couple’s belongings, mugs on the sill; a platform and a green commuter train through the window, morning light',
  'sd-parking-ufa':
    'The interior of a heated underground parking garage in a Russian city in deep winter: cars covered in frost driving down the ramp, melting snow on the concrete, warm yellow lamps inside against cold blue daylight at the entrance',
  'sd-parking-kzn':
    'An underground parking level beneath a modern Russian business centre: full rows of cars, numbered bays painted on clean concrete, cool even lighting, one car waiting for a free space',
  'sd-kladovka-kzn':
    'A small basement storage room of about four square metres in a modern Russian apartment complex, packed neatly with skis, a folded pram, a stack of car tyres and boxes; a corridor of identical metal storage doors behind, single lamp',
  'sd-kladovka-ufa':
    'A clean empty five square metre storage locker in the basement of a new Russian residential complex: metal door swung open, empty steel shelving, bright practical lighting, the corridor receding into perspective',
  'sd-parking-chelny':
    'A snowy Russian courtyard in winter: cars buried under snowdrifts, a small tractor pushing a snowbank across the exit, one cleared covered parking spot in the foreground, flat grey winter daylight',
  'sd-land-iglino':
    'An empty plot of land on the edge of a Russian village: wooden survey stakes with string, a strip of fresh asphalt along the boundary, a birch grove and wooden houses beyond, yellow gas pipeline posts, clear summer daylight',
  'sd-land-laishevo':
    'A grassy plot of land sloping down toward a wide calm river, wild flowers, a worn footpath to the water, distant sailboats and a far bank, warm early evening light',
  'sd-land-tukaevo':
    'A small country plot with survey markers and fence posts; on the neighbouring plot a freshly built wooden banya with smoke rising from its chimney, vegetable beds, summer daylight',
  'sd-land-m12':
    'A flat roadside plot of empty land beside a brand-new Russian motorway: trucks and cars streaming past, a clean concrete exit ramp curving away, steel gantry structures without any signage, wide fields to the horizon, bright day',
}

/** Малые сделки — акции и активы. Одна картинка на ТИКЕР. */
const SCENES_STOCK = {
  'AAPL':
    "A workbench with a laptop, phone and tablet of one ecosystem laid out neatly, clean studio light, product photography mood",
  'NVDA':
    "A high-end graphics card lying on an anti-static mat beside a screwdriver and a server rack blinking in the background, cool blue light",
  'ASML':
    "A cleanroom interior with a huge precision lithography machine, engineers in white suits at a distance, sterile bright light",
  'TSM':
    "A semiconductor wafer held in gloved hands under bright cleanroom light, reflections rainbowing across its surface",
  'PLZL':
    "An open-pit gold mine in Siberia: terraced rock walls, haul trucks far below, cold clear daylight",
  'ISWD':
    "A calm desk with a printed portfolio statement showing a diversified world index, a globe paperweight and a cup of tea, morning light",
  'BTC':
    "A hardware crypto wallet on a slate surface beside a paper seed phrase in a sealed envelope, moody directional light",
  'ETH':
    "A dark desk with a monitor showing a network of connected nodes, keyboard and coffee, focused night lighting",
  'SOL':
    "A monitor showing a steep chart that collapsed and then recovered, a notebook with handwritten dates beside it, evening desk light",
  'ALGO':
    "A quiet office desk with a framed certificate of compliance on the wall behind a monitor showing a flat chart, soft daylight",
  'PEPE':
    "A cluttered desk at night with two screens: one a volatile chart, one a fast-scrolling chat, monitor glow",
  'MOONX':
    "A laptop in a dark room showing a brand new token launch page with a countdown and anonymous avatars, cold screen light",

  GRIT: 'An industrial robotics assembly hall: a large orange articulated robot arm being calibrated on a workbench, a second robot built as a street-sweeping machine nearby, engineers in clean overalls, high factory windows with daylight streaming in',
  ZAP: 'A row of electric kick scooters docked at a charging rack on a city embankment on a bright summer morning, one rider gliding past, river and trees behind',
  MYCO: 'A biotech laboratory bench: glass flasks and trays of growing mushroom cultures under soft grow lights, a scientist in a white coat holding a petri dish up to the light, clean modern lab',
  SNAIL: 'A vast parcel logistics warehouse: a very long conveyor loaded with cardboard boxes, tall racking rising into the distance, a single worker scanning a parcel, cool even light',
  NEST: 'A calm private wealth adviser office: a wooden desk, two armchairs, a potted plant, a tablet propped up showing one simple rising abstract line with no text, a wide window with a soft city view, warm daylight',
  SHIB: 'A Shiba Inu dog sitting upright on a desk beside a keyboard in a home office at night, screen glow on its fur, mugs and a plant around, playful mood',
  WIF: 'A small dog wearing a knitted pink beanie hat sitting on a windowsill, warm room behind, blurred city lights outside, cosy evening light',
  DOGE: 'An elderly Shiba Inu with a grey muzzle resting in a worn leather armchair in a warm living room, sunbeam across the rug, dignified and calm',
  GOLD: 'A jeweller workbench: several small gold bars and gold grain on a precision balance, tweezers and a loupe beside them, warm lamp light on dark wood, deep shadows',
  SUKUK: 'A calm office where one person hands a set of keys and a bound paper folder across a wooden desk to another, a detailed architectural model of an apartment building standing on the desk between them, warm daylight',
}

/**
 * Карточки рынка. Их 22 и они «событийные», а не предметные, поэтому сцена
 * рисует НАСТРОЕНИЕ рынка через узнаваемое место, а не абстракцию: абстракцию
 * модель неизбежно сводит к стрелочкам и графикам, то есть к стоку.
 */
const SCENES_MARKET = {
  'mkt-price-nvda-peak':
    "A newsroom screen wall showing a technology company stock at an all-time high, analysts gesturing at charts, bright studio light",
  'mkt-price-nvda-dip':
    "A warehouse stacked to the ceiling with unsold boxed graphics cards, a lone forklift, cold fluorescent light",
  'mkt-price-btc-peak':
    "A phone on a cafe table showing a crypto price at a record high, strangers at the next table looking at their own screens, bright daylight",
  'mkt-price-btc-dip':
    "A dim room with a monitor showing a collapsed crypto chart and a frozen exchange notice, cold light, empty coffee cup",
  'mkt-price-sol-dip':
    "A monitor showing a chart that has fallen almost to the floor of the screen, sticky notes with older higher prices peeled off beside it, dim light",
  'mkt-price-sol-peak':
    "A monitor showing a chart that has climbed back above its previous peak, a small paper calendar with dates circled beside it, morning light",
  'mkt-price-aapl-dip':
    "A phone shop window in a large Asian city with fewer customers than usual, reflections of the street, overcast day",
  'mkt-price-asml-peak':
    "A vast cleanroom with a precision lithography machine being crated for shipment, engineers with clipboards, bright industrial light",
  'mkt-price-tsm-dip':
    "A newsroom map showing a narrow strait between two coastlines with naval markers, muted studio lighting",
  'mkt-price-algo-dip':
    "A quiet monitor showing a long flat chart far below its starting point, a dusty framed certificate on the wall behind, dim office",
  'mkt-split-nvda':
    "A single share certificate on a desk being replaced by ten smaller identical ones laid out in a row, overhead studio light",
  'mkt-split-aapl':
    "One large document divided into four equal parts on a clean desk, scissors and a ruler beside them, bright even light",
  'mkt-split-plzl':
    "A single heavy gold bar beside ten small identical gold coins on a dark cloth, precise directional light",

  'gl-social':
    "A person filming a short video on a phone tripod at a kitchen table, ring light glowing, laptop showing a rising audience chart, evening",
  'gl-leader-in':
    "Two people shaking hands across a cafe table, notebooks and coffee between them, a group of colleagues visible in the background, warm light",
  'gl-two-legs':
    "A community meeting room with two lively groups of people talking on either side of the room, chairs arranged in a circle, bright daylight",
  'gl-mentor-help':
    "An older mentor and a younger partner sitting side by side at a table with a notepad, mid-conversation, sunlit room",
  'gl-school':
    "A small training session: five people around a table taking notes while one explains something on a flipchart, natural light",
  'gl-city':
    "A modest hotel conference room in a provincial Russian city, full rows of chairs, people talking after a presentation, evening light through blinds",
  'gl-blocked':
    "A phone on a desk showing a blocked social media account screen, notebook and cold coffee beside it, dim room, muted mood",
  'gl-summer':
    "An empty office desk in summer: silent phone, dried plant, sunlight through blinds, a postcard from the seaside pinned to the wall",
  'gl-mentor-burn':
    "A tired person sitting alone at a kitchen table late at night, laptop closed, cold tea, dim lamp light",
  'gl-leader-gone':
    "An empty chair at a meeting table with an unopened notebook on it, the rest of the group visible out of focus behind, subdued light",
  'gl-triangle':
    "Three identical desk workspaces side by side in a home office, each with a laptop and a notebook, clean modern room, morning light",
  'gl-promo-travel':
    "A packed carry-on suitcase, passport and boarding pass on a bed, city skyline photograph on the wall, morning light",
  'gl-promo-auto':
    "A bank notification on a phone screen showing an incoming annual bonus, lying on a wooden table with a calendar and a cup of tea",
  'gl-after-travel':
    "Two people who met on a trip working together over a laptop in a bright cafe, a rising chart on screen, city outside the window",
  'mkt-price-moonx-rug':
    "A laptop screen showing a deleted project page and an empty chat, an unplugged desk lamp beside it, cold blue night light in an empty room",
  'mkt-price-moonx-pump':
    "A phone screen showing a vertical green price spike, held over a table crowded with notifications, bright artificial light",
  'mkt-price-shib-dip':
    "A quiet desk with a monitor showing a flat declining chart and an empty chat window, dust in a sunbeam, muted daytime",
  'mkt-price-pepe-peak':
    "A monitor showing a sharply rising chart with a crowded comment feed beside it, energetic screen glow in a dark room",
  'friction-payment-blocked':
    "A phone screen showing a declined international payment, a bank card lying beside it on a kitchen table, cold morning light",
  'friction-account-closed':
    "An official bank letter lying open on a desk beside a cut bank card and a closed laptop, grey daylight through a window",
  'friction-visa-run':
    "A rejected visa application form and an unused passport on a table with airline tickets, dim indoor light",

  'mkt-sell-room-ufa':
    'A queue of prospective tenants waiting on a stair landing outside an open apartment door in a Soviet-era block, an agent with a folder greeting them, worn tiles, daylight from a stairwell window',
  'mkt-sell-apt-kzn':
    'A busy modern residential complex courtyard in Kazan on a bright day: young families with boxes moving in, a van with its doors open, white-and-brick towers around, fresh landscaping',
  'mkt-sell-apt-msk':
    'A high floor Moscow apartment with floor-to-ceiling windows overlooking a dense skyline of towers at golden hour, a couple standing at the glass with an agent, sparse elegant furniture',
  'mkt-sell-apt-spb':
    'A Saint Petersburg apartment with tall windows, stucco cornices and herringbone parquet, a canal and pastel facades visible outside, soft northern light, an easel with a canvas in the corner',
  'mkt-sell-apt-dxb':
    'A Dubai high-rise apartment interior with a wide balcony, the marina and towers beyond, harsh midday sun, an agent with a tablet and a departing family with suitcases in the hallway',
  'mkt-sell-apt-tur':
    'A whitewashed Turkish coastal apartment with a bougainvillea-framed balcony above a blue bay, buyers on the terrace with an agent, bright Mediterranean light',
  'mkt-sell-parking':
    'A tightly packed residential courtyard where cars are parked bumper to bumper on every scrap of asphalt, one empty marked bay in the middle, evening light between the blocks',
  'mkt-sell-land':
    'A surveyor with a tripod on an open green field marked out with wooden stakes and orange tape, a group of buyers walking the plot behind, distant village roofs, wide sky',
  'mkt-sell-house-rf':
    'A wooden country house outside a Russian city with a wide veranda, a car loaded with boxes in the drive, a family carrying a laptop and a plant inside, pines and long afternoon shadows',
  'mkt-sell-biz-food':
    'A small city cafe seen from outside at dusk with every table taken and warm light in the windows, two people in business coats studying the entrance from the pavement',
  'mkt-sell-biz-service':
    'A small service workshop counter — repair benches and neatly labelled parts drawers behind — with a courier in branded uniform collecting a stack of orders, cool bright light',
  'mkt-sell-partnership':
    'A large distribution warehouse office: crates of packaged goods stacked behind, two people shaking hands across a desk while a third counts cartons with a clipboard, industrial daylight',
  'mkt-price-grit-peak':
    'A robotics showroom stage where an articulated orange robot arm performs a fluid sweeping motion in front of a seated audience with phones raised, spotlights, dark hall',
  'mkt-price-grit-dip':
    'A robotics workshop after a mishap: an articulated robot arm slumped forward on a bench, a toppled crate of parts on the floor, two engineers examining it, cold overhead light',
  'mkt-price-snail-dip':
    'A parcel depot at a standstill: a stopped conveyor piled with boxes, spilled parcels on the floor, one worker standing with hands on hips, dim end-of-shift light',
  'mkt-price-myco-peak':
    'A biotech grow room with racks of thriving mushroom cultures under violet-tinted grow lights, scientists photographing a tray, clean bright lab',
  'mkt-price-zap-dip':
    'A pile of electric kick scooters lying tangled on a wet city pavement beside an empty charging rack, grey rainy light, one passer-by with an umbrella',
  'mkt-price-nest-peak':
    'A private banking lounge at golden hour: a wide desk, two armchairs, a champagne bucket to one side, a tablet propped up showing one clean rising abstract line with no text, city skyline through glass',
  'mkt-price-pepe-moon':
    'A green cartoon frog plush toy strapped into a toy rocket on a desk covered in monitors at night, room lit by screen glow, playful chaotic mood',
  'mkt-price-doge-floor':
    'An elderly Shiba Inu asleep on a rug beside a dark desk in a night-time room, one screen dimly glowing, quiet and still',
  'mkt-price-gold-peak':
    'A bank vault interior with neatly stacked gold bars on steel shelving, a guard closing a heavy door, cold directional light and long shadows',
  'mkt-price-sukuk-issue':
    'A calm signing ceremony in a modern office: several people around a long table with bound folders in front of each, an architectural model of a warehouse at the centre, wide window light',
  'mkt-split-shib':
    'Several Shiba Inu puppies scattered across a home office floor among cushions and a keyboard, warm daylight, cheerful mess',
  'mkt-split-bonk':
    'A litter of small dogs tumbling out of an open cardboard box in a bright living room, toys strewn around, playful energy',
  'mkt-split-wif':
    'Two small dogs in knitted beanie hats pressed together on a windowsill, warm room, city evening light outside',
  'mkt-split-doge':
    'A group of Shiba Inus of different ages sitting together on a wide sofa in a warm living room, sunbeam across them, calm and comic dignity',
  'mkt-wind-tax-refund':
    'A person at a kitchen table opening an official envelope with visible relief, laptop and coffee beside them, morning light through the window',
  'mkt-wind-cashback':
    'A person on a sofa smiling at their phone with shopping bags and a card on the coffee table, cosy living room, warm lamp light',
  'mkt-wind-rent-review':
    'A landlord and tenant shaking hands in the doorway of a rented flat, a folder of papers under one arm, hallway daylight',
  'mkt-wind-autopromo':
    'A small team celebrating in a modest office: a cake on a desk, someone being applauded, boxes of packaged goods stacked along the wall, warm daylight',
  'mkt-raise-promotion':
    'A manager handing over a folder to a smiling employee in a glass-walled meeting room while colleagues applaud outside, bright office daylight',
  'mkt-raise-new-job':
    'A person carrying a small box of desk belongings into a new open-plan office, colleagues looking up in welcome, morning light through wide windows',
  'mkt-raise-bonus-to-salary':
    'A person at a home desk reviewing a payslip with quiet satisfaction, calculator and coffee beside them, plant on the sill, soft daylight',
  'mkt-raise-side-hustle':
    'A person packing handmade goods into parcels at a kitchen table late in the evening, laptop open beside a stack of finished orders, warm lamp light',
}

/**
 * Клетки-события (обе дорожки). Их немного и они повторяются, поэтому картинка
 * одна на ТИП клетки, а не на каждое попадание: рисуем ситуацию, в которую
 * попал игрок, — так карточка читается с одного взгляда.
 */
const SCENES_SPACES = {
  charity:
    'A person handing a bundle of banknotes across a table to a volunteer in a community hall, boxes of food aid stacked behind, other volunteers sorting donations, warm daylight through high windows',
  baby: 'A nursery corner at home: a wooden cot with a mobile above it, folded tiny clothes on a chest of drawers, a parent standing in the doorway holding a bundled newborn, soft morning light',
  downsized:
    'A person walking out of an office building carrying a cardboard box of desk belongings, glass doors and grey pavement, overcast light, quiet and undramatic',
  market:
    'A busy trading floor of a small brokerage: several people at desks with multiple blank monitors, one standing and gesturing across the room, cool blue-grey light',
  doodad:
    'A cluttered hallway of a flat after an impulse purchase: shopping bags and an open cardboard box with packaging spilling out, a new appliance on the floor, warm evening lamp light',
  paycheck:
    'A person at a kitchen table checking their phone banking app with a coffee and a notebook beside them, calm morning light through the window',
  cashflowDay:
    'A calm home office at the end of the month: a desk with a laptop, a stack of paid invoices squared up, a cup of tea, a plant on the sill, warm late-afternoon light',
  taxAudit:
    'A meeting room where an inspector in a plain suit spreads out folders and printouts across the table while the owner of a business watches from the other side, cold overhead light, tense but civil',
  lawsuit:
    'A courthouse corridor: two lawyers with document folders conferring on a wooden bench, tall arched windows and stone floor, long shadows',
  divorce:
    'Two people sitting on opposite sides of a mediator’s desk in a plain office, a folder of documents between them, both looking down, flat daylight, restrained and sad',
}

/**
 * Обложки трёх колод — их видно на самом первом экране, при выборе игры.
 * Раньше там стояли эмодзи (флаг, ничего, ничего), и экран выглядел
 * недоделанным. Сцена показывает МИР колоды, а не абстрактную «Россию».
 */
const SCENES_DECKS = {
  ru: 'A Russian provincial city street on a clear day: a mid-rise brick apartment block with a small bakery and a parcel pickup point on the ground floor, a parked delivery van, birch trees along the pavement, people walking with shopping bags, warm daylight',
  offshore:
    'A South American coastal town from a hillside: pastel low-rise houses with terracotta roofs, palm trees, a wide river estuary and open sea beyond, small farms visible on the green hills behind, bright clear afternoon',
  classic:
    'A North American suburban street of detached houses with wide lawns and driveways, a modest strip of shops at the corner, a distant downtown skyline on the horizon, clean midday light',
}

/**
 * Полотно доски. Это не «картинка на странице», а поверхность, на которой
 * лежат клетки, — поэтому сцена намеренно СПОКОЙНАЯ: фактура и лёгкая
 * печатная рамка, никаких предметов и сюжета. Любая деталь тут будет спорить
 * с фишками и подписями.
 */
const SCENES_BOARD = {
  surface:
    'Top-down flat photograph of a premium board game playing surface: warm off-white pressed paper board with a fine linen grain, very subtle paper fibre texture, a faint blind-embossed decorative border frame just inside the edges, soft even studio lighting with almost no shadow, extremely low contrast, muted warm neutral tones with a whisper of sage green. Completely empty surface. No objects, no cards, no pieces, no text, no letters, no numbers, no logos.',
  center:
    'Top-down flat photograph of a shallow circular inlay in a premium board game: a smooth warm off-white paper medallion set into the board, ringed by a fine blind-embossed double circle and a delicate laurel-like botanical engraving in pale sage green, soft even studio lighting, very low contrast, empty flat centre with room to breathe. No text, no letters, no numbers, no symbols, no logos.',
}

/**
 * Две подложки доски на сравнение (решение Камиля: посмотреть оба подхода).
 *  plate-a — ТОЛЬКО поверхность: клетки потом кладёт код ровно по сетке 7×7.
 *  plate-b — доска ЦЕЛИКОМ, вместе с клетками: красивее, но координаты клеток
 *            придётся размечать руками под конкретную картинку.
 */
const SCENES_PLATE = {
  'plate-a':
    'Top-down photograph of an empty premium board game board, perfectly square, seen straight from above. Warm ivory pressed paper with fine linen grain, a slim blind-embossed double border frame set in from the edges, delicate corner flourishes in pale sage green, a large calm empty area in the middle with a faint embossed compass-rose-like geometric ornament. Soft even studio light, no shadows, very low contrast, muted warm neutral palette. Completely empty playing area — no squares, no spaces, no grid, no tiles, no cards, no pieces. No text, no letters, no numbers, no logos.',
  'plate-b':
    'Top-down photograph of a premium minimalist board game board, perfectly square, seen straight from above, filling the frame edge to edge. Warm ivory pressed paper with fine linen grain. One continuous track of small rounded square spaces runs around the outer edge in a closed loop: exactly seven equal spaces along the top edge, seven down the right edge, seven along the bottom, seven up the left, corners shared, all identical in size, evenly spaced, perfectly aligned to a strict grid. Each space is a flat pale card with a thin sage green outline and a subtle drop shadow, clearly separated from its neighbours by a small even gap. The whole middle of the board is completely empty warm ivory with only a very faint embossed geometric ornament. Soft even studio light, no cast shadows, low contrast, calm muted palette. No text, no letters, no numbers, no icons, no illustrations inside the spaces, no game pieces, no cards, no dice, no logos.',
}

/**
 * Пять досок на выбор. Требование Камиля — «прикольные разные, а не грустные»,
 * поэтому каждая живёт в своём мире, а не отличается оттенком бежевого.
 * Условие у всех одно: ровно 7 клеток на сторону и ПУСТАЯ середина — туда
 * интерфейс кладёт имя ходящего.
 */
const RING_RULE = 'One continuous track of small rounded square spaces runs around the outer edge in a closed loop: exactly seven equal spaces along the top edge, seven down the right, seven along the bottom, seven up the left, corners shared, all identical in size, evenly spaced, aligned to a strict grid, each clearly separated from its neighbours by an even gap. The entire middle of the board is empty with no spaces at all. No text, no letters, no numbers, no icons or pictures inside the spaces, no game pieces, no dice, no cards, no logos.'

const SCENES_TABLE = {
  felt:
    'Top-down photograph of a luxurious private club game board, perfectly square. Deep emerald green billiard felt surface with visible soft nap, framed by a polished brass edge with mitred corners. ' + RING_RULE.replace('spaces', 'spaces of warm cream inlay with thin gold-foil outlines and a soft raised edge') + ' Rich saturated colour, warm directional light, gentle sheen on the brass.',
  city:
    'Top-down illustrated city map board, perfectly square, in the style of a beautiful printed tourist map. A stylised city seen from directly above: a winding blue river, green parks with tiny trees, a lake, blocks of small flat-roofed houses in warm terracotta and cream, tiny cars on pale streets. ' + RING_RULE.replace('spaces', 'spaces drawn as clean white paper plots with thin dark outlines, laid along a ring road') + ' Bright cheerful palette, crisp flat vector-like illustration.',
  island:
    'Top-down illustrated tropical island map board, perfectly square. Turquoise sea with gentle wave lines, a sandy island in the middle with palm groves, a small volcano, coral reefs and a wooden pier. ' + RING_RULE.replace('spaces', 'spaces drawn as pale sand-coloured stepping stones with soft shadows, forming a path around the shoreline') + ' Vivid holiday colours, playful hand-drawn feel, crisp flat illustration.',
  retro:
    'Top-down photograph of a 1970s printed board game, perfectly square. Bold graphic print on thick cardboard: wide bands of burnt orange, teal and cream, thick black outlines, visible halftone dot texture and slight ink misregistration. ' + RING_RULE.replace('spaces', 'spaces printed as flat bright rectangles alternating cream and mustard, each with a thick black outline') + ' Confident retro poster style, warm nostalgic colours.',
  greenleaf:
    'Top-down photograph of a premium modern board game, perfectly square. Fresh sage and deep forest green surface with a subtle botanical pattern of delicate leaf silhouettes, a slim gold border frame. ' + RING_RULE.replace('spaces', 'spaces of clean warm white card with thin gold outlines and a soft drop shadow') + ' Elegant natural palette of greens, cream and gold, calm and expensive looking.',
}

/**
 * Городские поля. Вместо острова — мировые города, по клетке на достопримечательность
 * (задача Камиля). Стиль снят с его референсов словами: объёмный макет-диорама,
 * вид сверху, вечерний свет, живая миниатюра — но композиция своя, чужие концепты
 * не копируем и лишнего в кадр не тянем.
 *
 * Два формата: квадрат (кольцо 7×7 = 24 клетки) и во всю ширину экрана
 * (кольцо 9×5 = тоже 24). Счёт клеток проговаривается жёстко — модель охотно
 * добавляет лишний ряд, мы это уже ловили на острове.
 */
const RING_SQUARE =
  'A ring of 24 empty game spaces runs around the outer edge: exactly seven along the top edge, ' +
  'seven along the bottom edge, and exactly five on the left edge and five on the right edge between the corners. ' +
  'Do not add any extra row or column of spaces. All spaces are identical rounded squares of the same size, ' +
  'evenly spaced, aligned to a strict grid, each a clean empty pale card with a thin outline and a soft shadow. ' +
  'The spaces are completely EMPTY — nothing drawn inside them. The whole middle of the board is open scenery with no spaces at all.'

const RING_WIDE =
  'A ring of 24 empty game spaces runs around the outer edge: exactly nine along the top edge, nine along the bottom edge, ' +
  'and exactly three on the left edge and three on the right edge between the corners. Do not add any extra row or column. ' +
  'All spaces are identical rounded squares of the same size, evenly spaced, aligned to a strict grid, each a clean empty pale card ' +
  'with a thin outline and a soft shadow. The spaces are completely EMPTY — nothing drawn inside them. ' +
  'The whole middle is open scenery with no spaces at all.'

const CITY_WORLD =
  'Between and behind the spaces, all around the edge of the board, sits a tiny hand-crafted world of famous cities in miniature: ' +
  'Dubai with its needle tower and palm island, Istanbul with domes and minarets over the strait, Antalya with a marina and cliffs, ' +
  'Kazan with a white kremlin and a blue-domed mosque, Moscow with towers by a river, Baku with curved glass towers, ' +
  'Singapore with a boat-topped tower and gardens, Cairo with pyramids at the desert edge. ' +
  'Each city is a small detailed diorama the size of a few spaces, separated from its neighbours by water, sand or greenery. ' +
  'No text, no letters, no numbers, no labels, no logos.'

const SCENES_CITY = {
  'city-diorama':
    'Top-down photograph of a luxurious miniature board game, perfectly square, shot straight from above. ' +
    RING_SQUARE + ' ' + CITY_WORLD +
    ' Warm evening light, tiny glowing windows, deep soft shadows, rich photoreal miniature-model look, shallow depth cues.',
  'city-isometric':
    'Top-down illustration of a bright stylised game board, perfectly square. ' +
    RING_SQUARE + ' ' + CITY_WORLD +
    ' Vivid saturated colours, soft white clouds curling at the outer corners, crisp clean 3D-render look, cheerful daylight.',
  'city-parchment':
    'Top-down photograph of an antique explorer map board, perfectly square, aged parchment with a subtle grid border. ' +
    RING_SQUARE + ' ' + CITY_WORLD.replace('tiny hand-crafted world', 'hand-drawn ink-and-watercolour world') +
    ' Sepia and faded blue-green washes, fine pen hatching, compass rose in one corner, warm lamp light.',
  'city-soft':
    'Top-down illustration of a calm modern game board, perfectly square, in a clean contemporary app style. ' +
    RING_SQUARE + ' ' + CITY_WORLD +
    ' Soft matte pastel palette of sand, sage and cream, gentle even light, very low contrast, simplified rounded shapes.',
  'city-night':
    'Top-down photograph of a premium night-time miniature board, perfectly square. ' +
    RING_SQUARE + ' ' + CITY_WORLD +
    ' Deep midnight blue water and dark ground, cities glowing with warm gold and cool cyan lights, reflections on the water, dramatic and expensive.',
}

const SCENES_CITY_WIDE = {
  'wide-diorama':
    'Top-down photograph of a luxurious miniature board game, WIDE horizontal format, shot straight from above. ' +
    RING_WIDE + ' ' + CITY_WORLD +
    ' Warm evening light, tiny glowing windows, deep soft shadows, rich photoreal miniature-model look.',
  'wide-isometric':
    'Top-down illustration of a bright stylised game board, WIDE horizontal format. ' +
    RING_WIDE + ' ' + CITY_WORLD +
    ' Vivid saturated colours, soft white clouds at the outer corners, crisp clean 3D-render look, cheerful daylight.',
  'wide-parchment':
    'Top-down photograph of an antique explorer map board, WIDE horizontal format, aged parchment with a fine grid border. ' +
    RING_WIDE + ' ' + CITY_WORLD.replace('tiny hand-crafted world', 'hand-drawn ink-and-watercolour world') +
    ' Sepia and faded blue-green washes, fine pen hatching, compass rose in a corner, warm lamp light.',
  'wide-soft':
    'Top-down illustration of a calm modern game board, WIDE horizontal format, clean contemporary app style. ' +
    RING_WIDE + ' ' + CITY_WORLD +
    ' Soft matte pastel palette of sand, sage and cream, gentle even light, very low contrast, simplified rounded shapes.',
  'wide-night':
    'Top-down photograph of a premium night-time miniature board, WIDE horizontal format. ' +
    RING_WIDE + ' ' + CITY_WORLD +
    ' Deep midnight blue water, cities glowing with warm gold and cool cyan lights, reflections on the water, dramatic and expensive.',
}

/**
 * Полноэкранные интерфейсы (16:9). Это НЕ карта с клетками — это весь экран
 * игры: доска в центре, вокруг панели, как в компьютерной игре.
 *
 * 🔴 Зачем они нужны, если панели всё равно будет рисовать код: это ЭТАЛОН
 * ВИДА. Живые панели с настоящими цифрами картинкой быть не могут — их
 * содержимое меняется каждый ход. Поэтому картинка задаёт язык (материал,
 * скругления, свет, палитру), а интерфейс потом собирается кодом поверх
 * сгенерированного фона. Текст просим НЕ рисовать: модель путает буквы.
 */
const HUD_LAYOUT =
  'Full-screen video game interface seen straight on, 16:9, edge to edge. ' +
  'In the CENTRE: a square game board seen from directly above, with a ring of 24 identical empty rounded spaces around its edge ' +
  'and a miniature world of famous cities inside — Dubai with its needle tower, Istanbul with domes and minarets, Antalya marina, ' +
  'Kazan white kremlin, Baku curved towers, Cairo pyramids. ' +
  'On the LEFT: a tall vertical panel divided into four stacked empty sections with small coloured accents. ' +
  'On the RIGHT: a narrow vertical column of a few small panels and one large prominent action button. ' +
  'ALONG THE TOP: a slim horizontal bar with several small rounded chips. ' +
  'All panels are empty containers — no writing inside them. ' +
  'No text, no letters, no numbers, no words, no labels, no logos anywhere in the image.'

const SCENES_HUD = {
  'hud-glass':
    HUD_LAYOUT + ' Style: frosted translucent glass panels floating over the scene, soft blur, thin light edges, ' +
    'warm evening light on the city below, deep blue-grey ambience, premium and calm.',
  'hud-warm':
    HUD_LAYOUT + ' Style: warm ivory panels with soft shadows over a sunlit miniature world, sand and sage palette, ' +
    'gentle rounded shapes, clean modern app look, very low contrast, airy.',
  'hud-night':
    HUD_LAYOUT + ' Style: dark charcoal-green panels with thin gold edges over a night city scene glowing gold and cyan, ' +
    'reflections on dark water, cinematic and expensive.',
  'hud-paper':
    HUD_LAYOUT + ' Style: everything printed on aged parchment — panels are paper cards pinned to a desk, ' +
    'the board is a hand-drawn ink and watercolour map, brass instruments in the corners, warm lamp light.',
  'hud-flat':
    HUD_LAYOUT + ' Style: clean flat modern dashboard, white and pale sage panels with generous rounded corners and soft drop shadows, ' +
    'a bright simplified 3D city diorama in the middle, cheerful daylight, crisp and minimal.',
}

/**
 * Интерфейсы по двум референсам Камиля.
 *
 * r6 — светлый плоский дашборд: узкая колонка значков слева, крупные белые
 *      карточки со скруглениями, зелёный акцент, объёмная сценка-«ломоть»
 *      посередине, таблетка навигации внизу.
 * r1 — физический макет на подносе, за ним и над ним парят панели из
 *      матового стекла, вечерний свет, тёплые огни в окнах.
 *
 * Общее для всех: панели ПУСТЫЕ и текста нет — цифры и надписи печатает
 * интерфейс, а буквы генератор путает.
 */
const BOARD_IN_MIDDLE =
  'In the middle sits the game board: a square slab seen from above with a ring of exactly 24 identical empty rounded spaces ' +
  'around its outer edge — seven along the top, seven along the bottom, five on each side between the corners — and inside the ring ' +
  'a miniature world of famous cities: Dubai needle tower and palm island, Istanbul domes and minarets, Antalya marina and cliffs, ' +
  'Kazan white kremlin, Baku curved towers, Cairo pyramids. The spaces are completely empty. '

const NO_TEXT =
  'All panels and cards are EMPTY containers with no writing in them. ' +
  'No text, no letters, no numbers, no words, no labels, no logos anywhere in the image.'

const R6 =
  'Full-screen app interface, 16:9, seen straight on, edge to edge. Warm cream background. ' +
  'A narrow vertical rail of six small rounded-square icon buttons runs down the far left edge, one of them highlighted deep green. ' +
  'Large white rounded cards with soft drop shadows are arranged around the screen: a wide card top-left, ' +
  'a deep-green rounded card top-right, a tall card of three stacked list rows bottom-right, a small card bottom-left. ' +
  'A pill-shaped bar with five round icon slots floats at the bottom centre. ' + BOARD_IN_MIDDLE +
  'Style: clean flat modern app design, generous rounded corners, soft realistic shadows, olive and forest green accents, ' +
  'sand and cream palette, gentle even daylight, simplified 3D shapes. ' + NO_TEXT

const R1 =
  'Full-screen scene, 16:9, seen straight on. A physical miniature model sits on a smooth white tray base with rounded corners, ' +
  'photographed in a softly lit studio against a deep blue-grey backdrop. ' +
  'Rising behind the model is a large sheet of frosted transparent glass acting as a screen, with several empty frosted glass panels ' +
  'floating on it: a wide one upper-left, a small one upper-right, a tall one on the right. ' +
  'A row of four small frosted glass buttons rests on the tray in front, one of them glowing accent blue. ' + BOARD_IN_MIDDLE +
  'Style: photoreal 3D render of a physical diorama, warm glowing tiny windows, evening blue ambience, ' +
  'soft reflections on the glass, premium product photography. ' + NO_TEXT

const SCENES_REF = {
  'r6-dubai': R6 + ' The city diorama leans towards Dubai and the Gulf: turquoise water, palm island, desert edge.',
  'r6-istanbul': R6 + ' The city diorama leans towards Istanbul: the strait, ferries, domes and minarets, red rooftops.',
  'r6-kazan': R6 + ' The city diorama leans towards Kazan and the Volga: white kremlin walls, blue domes, a wide river, birches.',
  'r6-antalya': R6 + ' The city diorama leans towards Antalya: cliffs over turquoise sea, marina, pines and old town roofs.',
  'r1-dubai': R1 + ' The miniature leans towards Dubai and the Gulf: turquoise water, palm island, glowing towers at dusk.',
  'r1-istanbul': R1 + ' The miniature leans towards Istanbul: the lit strait at dusk, ferries, domes and minarets aglow.',
  'r1-kazan': R1 + ' The miniature leans towards Kazan: floodlit white kremlin, blue domes, dark river reflecting the lights.',
  'r1-antalya': R1 + ' The miniature leans towards Antalya: cliffs and marina at dusk, warm harbour lights on dark water.',
}

/**
 * Фоны под доски. Отдельный слой: доска кладётся поверх, панели рисует код.
 *
 * Почему так, а не одной картинкой на весь экран (решение Камиля): цельный
 * макет всегда снят под углом, тащит лишние кнопки и не гнётся — ни под
 * телефон, ни под широкий монитор. Фон + доска + панели кодом дают тот же
 * вид и полную гибкость.
 *
 * 🔴 Требование к фону: СПОКОЙНАЯ СЕРЕДИНА. Там будет доска, и любая деталь
 * под ней превратится в грязь. Вся жизнь — по краям и углам.
 */
const BG_RULE =
  'Wide horizontal background image for a game screen, 3:2, seen straight on. ' +
  'The CENTRE of the image is calm and almost empty — a large quiet area where a board will be placed on top. ' +
  'All the interest lives around the outer edges and in the corners. Nothing important in the middle. ' +
  'No board, no game spaces, no grid, no cards, no panels, no interface elements, no people. ' +
  'No text, no letters, no numbers, no logos.'

const SCENES_BG = {
  'bg-diorama':
    BG_RULE + ' A dark walnut table top photographed from above in a warm evening studio: soft pool of light in the middle, ' +
    'deep shadows towards the corners, faint grain of the wood, a few blurred brass and glass objects at the very edges. ' +
    'Rich warm browns and amber, low contrast, expensive and quiet.',
  'bg-isometric':
    BG_RULE + ' A bright sky seen from high above: soft white cumulus clouds drifting in the corners, ' +
    'clear turquoise-blue air in the middle, tiny distant birds, gentle sunlight from the upper left. ' +
    'Vivid cheerful palette, crisp clean 3D-render look, airy and open.',
  'bg-soft':
    BG_RULE + ' A calm matte surface in soft pastel sand and sage: very gentle wide gradient, ' +
    'a few simplified rounded shapes and soft shadows drifting near the edges, like paper cut-outs. ' +
    'Muted warm palette, extremely low contrast, quiet modern and clean.',
  'bg-night':
    BG_RULE + ' Dark still water at night seen from above: deep midnight blue, faint ripples, ' +
    'scattered warm gold and cool cyan reflections near the outer edges from unseen city lights, ' +
    'a few dark rocks in the corners. Cinematic, deep and expensive.',
}

/**
 * Мир доски БЕЗ клеток.
 *
 * 🔴 Почему без. Замер: четыре городские доски × пять перерисовок — ни одна
 * не дала ровно 24 клетки, выходило 20–23. На занятой городской картинке
 * модель не держит счёт, а лишняя или недостающая клетка — это поехавшая
 * фишка. Клетки теперь рисует код поверх этого мира: они всегда на месте,
 * тянутся под любой экран (телефон!), умеют наведение и подсветку.
 * Картинка отвечает за красоту, код — за точность.
 */
const WORLD_RULE =
  'Square top-down illustration of a miniature world of famous cities, filling the frame edge to edge. ' +
  'Dubai with its needle tower and palm island, Istanbul with domes and minarets over the strait, ' +
  'Antalya with a marina and cliffs, Kazan with a white kremlin and blue domes, Baku with curved towers, ' +
  'Cairo with pyramids at the desert edge. The cities sit in a ring around the outside, separated by water, ' +
  'sand and greenery; the very middle is a calm open area with nothing important in it. ' +
  'A clean quiet margin of plain ground runs along all four outer edges. ' +
  'No game spaces, no squares, no tiles, no grid, no board frame, no cards, no pieces, no panels. ' +
  'No text, no letters, no numbers, no logos.'

const EVENT_RULE =
  'Editorial news photograph, horizontal 3:2 frame, natural light, documentary feel. ' +
  'No text, no letters, no numbers, no logos, no watermarks, no charts with readable labels. ' +
  'Muted realistic colour, shallow depth of field. Scene:'

/**
 * Иллюстрации мировых событий. Событие двигает рынок для всех сразу — оно
 * должно и выглядеть как новость, а не как строка текста.
 * Кадр репортажный: не метафора, а сцена, в которой это происходит.
 */
const SCENES_EVENTS = {
  "key-rate-cut-14":
    EVENT_RULE + ' ' + "A central bank press briefing screen showing a falling interest rate line, journalists photographing it, cool institutional light",
  "moscow-meter-750k":
    EVENT_RULE + ' ' + "A dense skyline of new Moscow residential towers at golden hour, cranes still working on the furthest ones",
  "country-house-revival":
    EVENT_RULE + ' ' + "A wooden country house outside a Russian city with a car being unpacked in the yard, laptop bag on the porch, birch trees, spring light",
  "rent-catches-up":
    EVENT_RULE + ' ' + "A young couple signing a rental agreement at a kitchen table in an empty flat, boxes stacked behind them, daylight through bare windows",
  "antalya-full-season":
    EVENT_RULE + ' ' + "A packed Antalya beachfront in high summer: full sunbeds, hotel towers behind, hazy hot light",
  "ai-demand-boom":
    EVENT_RULE + ' ' + "A server room aisle with racks lit blue, an engineer walking between them carrying a laptop",
  "partner-finance-expands":
    EVENT_RULE + ' ' + "A busy community hall meeting: rows of chairs full, people talking in groups after a presentation, warm daylight",
  "gold-record-5589":
    EVENT_RULE + ' ' + "Stacked gold bars on a dark vault shelf under a single hard light, price ticker glow reflecting off them",
  "sukuk-oversubscribed":
    EVENT_RULE + ' ' + "A calm modern finance office in the Gulf: glass wall, city beyond, printed certificates in a neat stack on the desk",
  "memecoin-january-run":
    EVENT_RULE + ' ' + "A phone screen showing a vertical green spike, held above a cluttered desk at night, monitor glow on the wall",
  "ipo-window-open":
    EVENT_RULE + ' ' + "A trading floor screen wall glowing green, analysts standing and pointing, bright newsroom light",
  "wage-war-for-staff":
    EVENT_RULE + ' ' + "A job fair hall with company booths and queues of candidates, banners overhead, bright convention lighting",
  "kazan-cools-off":
    EVENT_RULE + ' ' + "A quiet showroom of a new Kazan residential complex: model of the building, empty chairs, sales manager alone at the desk, grey afternoon",
  "dubai-handover-wave":
    EVENT_RULE + ' ' + "A row of newly finished Dubai towers with handover banners and moving trucks at the base, hot clear daylight",
  "dubai-holiday-home-permit":
    EVENT_RULE + ' ' + "An official Dubai municipality notice pinned by a building entrance, an empty short-let apartment lobby behind, strong midday sun",
  "lira-slides":
    EVENT_RULE + ' ' + "A currency exchange board in Istanbul showing a sliding rate, passers-by glancing at it, evening street light",
  "domestic-tourism-flat":
    EVENT_RULE + ' ' + "An empty Russian seaside promenade out of season: shuttered kiosks, one couple walking, grey overcast sea",
  "vat-threshold-20m":
    EVENT_RULE + ' ' + "A small business owner at a cluttered counter reading a tax notification on a laptop, coffee going cold, morning light",
  "container-price-double":
    EVENT_RULE + ' ' + "A container terminal crane lifting a box against a grey sky, stacks of containers receding into haze",
  "gold-pullback":
    EVENT_RULE + ' ' + "A jeweller weighing gold on a scale in a quiet shop, price display showing a lower number, warm lamp light",
  "bitcoin-under-90k":
    EVENT_RULE + ' ' + "A dark room with a monitor showing a collapsed crypto chart, an untouched cup of coffee beside the keyboard",
  "exchange-selloff":
    EVENT_RULE + ' ' + "A brokerage screen wall almost entirely red, a trader with hands behind head, harsh office light",
  "fuel-near-100":
    EVENT_RULE + ' ' + "A fuel station price sign at dusk with high numbers, a car filling up in the background, cold blue evening",
  "cadastre-tax-letters":
    EVENT_RULE + ' ' + "Official tax envelopes fanned out on a kitchen table beside reading glasses and a calculator, harsh overhead light",
  "friction-payment-blocked":
    EVENT_RULE + ' ' + "A phone screen showing a declined international payment, a bank card lying beside it on a kitchen table, cold morning light",
  "friction-account-closed":
    EVENT_RULE + ' ' + "An official bank letter open on a desk beside a cut bank card and a closed laptop, grey daylight through a window",
  "friction-visa-run":
    EVENT_RULE + ' ' + "A rejected visa application form and an unused passport on a table with airline tickets, dim indoor light",
}

const SCENES_WORLD = {
  'world-diorama': WORLD_RULE + ' Style: photoreal miniature model under warm evening light, tiny glowing windows, soft deep shadows.',
  'world-isometric': WORLD_RULE + ' Style: bright crisp 3D render, vivid saturated colours, soft clouds at the corners, cheerful daylight.',
  'world-soft': WORLD_RULE + ' Style: soft matte pastel illustration, sand and sage palette, simplified rounded shapes, very low contrast.',
  'world-night': WORLD_RULE + ' Style: night scene, deep midnight water, cities glowing warm gold and cool cyan, reflections, cinematic.',
}

/**
 * Фоны, заход второй. Первые Камилю не понравились.
 *
 * Что меняю по сравнению с первой попыткой: там были буквальные «столешница»
 * и «небо» — узнаваемые предметы, которые спорят с доской. Теперь фон —
 * АТМОСФЕРА, а не предмет: глубина, свет, лёгкая фактура. Середина по-прежнему
 * пустая: там лежит доска, и любая деталь под ней превращается в грязь.
 */
const BG2_RULE =
  'Wide horizontal abstract background for a game screen, 3:2. ' +
  'The centre is calm and almost empty — a large quiet area where a board will sit on top. ' +
  'All interest lives near the outer edges and corners, fading gently towards the middle. ' +
  'Soft vignette, subtle depth, no hard shapes in the centre. ' +
  'No board, no game spaces, no grid, no cards, no panels, no interface, no buildings, no people. ' +
  'No text, no letters, no numbers, no logos.'

const SCENES_BG2 = {
  'bg2-dusk':
    BG2_RULE + ' Deep teal-to-indigo gradient with a warm amber glow bleeding in from the lower left, ' +
    'like city light on evening haze. Fine film grain, smooth and cinematic.',
  'bg2-sand':
    BG2_RULE + ' Warm sand and cream, very soft, like fine paper lit from above; ' +
    'faint concentric ripples in the far corners, a whisper of sage green at the edges. Calm and expensive.',
  'bg2-emerald':
    BG2_RULE + ' Deep emerald green velvet fading to near black at the corners, ' +
    'a soft pool of warm light in the middle, delicate golden dust motes near the edges. Rich and quiet.',
  'bg2-marble':
    BG2_RULE + ' Pale warm marble with faint grey-gold veining drifting only along the outer edges, ' +
    'polished sheen, gentle soft shadow in the corners. Bright, clean, luxurious.',
  'bg2-ink':
    BG2_RULE + ' Dark slate blue washed like watercolour on textured paper, ' +
    'soft indigo and teal blooms in the corners, tiny scattered gold specks. Moody and hand-made.',
}

/**
 * Зелёные фоны — просьба Камиля: минималистично, премиально, с еле заметными
 * листьями. Листья должны угадываться, а не читаться: фон под доской и
 * панелями, любой заметный рисунок начнёт спорить с содержимым.
 */
const SCENES_GREEN = {
  'bg3-leaf':
    'Wide horizontal premium background, 3:2. Deep sage-and-forest green surface with a very faint, ' +
    'barely visible pattern of large botanical leaf silhouettes — tone-on-tone, almost the same colour as the ground, ' +
    'like blind embossing on thick paper. Leaves appear only near the outer edges and corners and fade out completely ' +
    'towards the middle. A soft pool of light in the centre, gentle vignette. ' +
    'Calm, expensive, minimal. No board, no spaces, no panels, no interface, no text, no letters, no numbers, no logos.',
  'bg3-mint':
    'Wide horizontal minimal background, 3:2. Soft pale mint and cream, a smooth wide gradient with a whisper of warm sand ' +
    'at the lower edge. Absolutely plain and quiet in the middle, faint soft shadow in the corners, fine paper grain. ' +
    'Bright, airy, premium and understated. No board, no spaces, no panels, no interface, no pattern in the centre, ' +
    'no text, no letters, no numbers, no logos.',
}

/** Большие сделки — недвижимость. */
const SCENES_BIG_RE = {
  'big-re-kzn-azino':
    'A tidy one-room apartment in a large Russian residential district: a suitcase by the door, family photographs on a shelf, tenants’ belongings still in place, tea things on the table, warm daylight',
  'big-re-kzn-pobedy':
    'A residential street five minutes from a metro station: the metro pavilion, a kindergarten playground and a small café on the ground floor of an apartment building, families walking, sunny day',
  'big-re-kzn-itpark':
    'A compact modern studio apartment beside a glass technology campus: a young developer with a backpack unlocking the door, bare bright interior visible behind, big windows, morning light',
  'big-re-msk-butovo':
    'A quiet courtyard of Moscow outskirts panel high-rises with a metro entrance nearby, autumn trees turning yellow, a man in a coat with a briefcase walking home, soft evening light',
  'big-re-msk-ttk':
    'A two-room apartment interior with a balcony overlooking a busy multi-lane city ring road at dusk, streams of car lights below, high-rises across the road, warm interior lamps',
  'big-re-msk-city':
    'A luxury high-rise apartment interior with floor-to-ceiling windows and a spectacular skyline of glass skyscrapers at golden hour, minimal expensive furniture, a phone on a tripod filming the view',
  'big-re-spb-kupchino':
    'A grey Soviet panel apartment block in Saint Petersburg under a low overcast sky, warm lit windows, a wet asphalt yard reflecting them, a lone figure with an umbrella walking home',
  'big-re-spb-vasilevsky':
    'A classical nineteenth-century Saint Petersburg apartment facade on a granite embankment during the white nights, pale blue twilight sky, students and tourists strolling, a bridge in the distance',
  'big-re-dxb-jvc':
    'A cluster of mid-rise sand-coloured apartment buildings in a Dubai suburban community: palm trees, a shared swimming pool, empty sunny walkways, hot bright midday light',
  'big-re-dxb-marina':
    'A Dubai marina waterfront at golden hour: tall curving glass towers around a basin full of yachts, a palm-lined promenade, a balcony railing in the foreground',
  'big-re-tur-alanya':
    'A Turkish Mediterranean apartment building with deep balconies and bougainvillea, the sea just across the road, palm trees and a beach promenade, bright warm daylight',
  'big-re-tur-istanbul':
    'A new but half-empty residential district on the outskirts of Istanbul: rows of new towers, unfinished landscaping and bare earth, very few people, a distant mosque silhouette, hazy daylight',
  'big-re-house-zubovo':
    'A brick family house in a Russian suburban village: fenced yard, a barbecue area with a grill, children’s bicycles and a trampoline on the lawn, birch trees, warm summer evening light',
  'big-re-house-kama':
    'A wooden riverside house with a banya and a small pier on a wide river: a gazebo with a laid table, boats moored, smoke rising from the banya chimney, warm summer evening',
  'big-re-chelny-studio':
    'A modern studio apartment block in a Russian factory town: workers in overalls walking home past the entrance, a vast truck plant on the horizon, cold clear daylight',
  'big-re-ufa-arena-studio':
    'A studio apartment building next to a modern ice hockey arena in a Russian city: fans in scarves walking toward the arena in the evening, warm street lamps, first snow on the ground',
}

/** Большие сделки — бизнес (включая партнёрскую программу — только живые сцены). */
const SCENES_BIG_BIZ = {
  'big-greenleaf':
    'A kitchen table meeting: a product catalogue open beside two cups of tea, a notebook with a simple hand-drawn team diagram, two people mid-conversation, warm home light',

  'big-biz-bakery-ufa':
    'Inside a busy bakery: a baker pulling flatbreads out of a clay tandoor oven with a long peel, trays of fresh loaves cooling on racks, flour dust hanging in the sunbeams, glowing oven mouth',
  'big-biz-halal-cafe-kzn':
    'A busy café at lunchtime: every table full, a cook plating rice pilaf behind the counter, steam rising, sunlight flooding through big windows, a mosque minaret visible outside',
  'big-biz-carwash-chelny':
    'A six-bay self-service car wash at night: one car covered in white foam, a driver holding the pressure lance, bright floodlights, wet reflective asphalt, other bays occupied',
  'big-biz-darkstore-msk':
    'A dark store at night: aisles of grocery shelves, pickers filling insulated backpacks from plastic crates, couriers wheeling scooters out into the lit city street',
  'big-biz-pvz-ufa':
    'A parcel pickup point interior: floor-to-ceiling shelves of packages in numbered bins, a clerk handing a box across the counter to a customer, a fitting cubicle curtain, bright practical lighting',
  'big-biz-barbershop-kzn':
    'A stylish barbershop with three chairs all occupied, barbers trimming beards, dark wood and brass fittings, large mirrors, warm pendant lamps',
  'big-biz-kids-center-ufa':
    'A bright children’s development centre: small children at low tables doing crafts with a teacher, colourful floor mats and soft toys, parents waiting in a lounge behind glass, big windows',
  // 🔴 Первая редакция («вертикальный вертел, повар режет мясо») отлетела от
  // safety-фильтра OpenAI. Сцену переписал на очередь и свет из окошка — мясорубных
  // деталей в промпте быть не должно.
  'big-biz-shaurma-spb':
    'A small late-night street food kiosk beside a metro exit: warm light spilling from the serving window, a queue of people in winter coats waiting their turn, steam rising into the cold air, neon reflections on wet pavement, city buildings behind',
  'big-biz-print-kzn':
    'A print shop with a large offset printing press running, stacks of freshly printed folded boxes and cards on pallets, an operator holding a sheet up to the light, industrial lighting',
  'big-biz-online-store':
    'A person at a laptop in a bright home office packing a gift box: wrapping paper, ribbon spools, tape gun, finished parcels stacked by the door, plants on the shelf, morning light',
  'big-biz-scooters-kzn':
    'A hundred electric scooters lined up along a river embankment on a summer evening, people riding past, a small service van with charging equipment and a technician',
  'big-partner-start-basic':
    'A person sitting at a kitchen table showing a small starter box of wellness product bottles to a friend across the table: an open printed product catalogue with photographs, a phone propped up showing a simple app screen, two cups of tea, warm daylight through the window',
  'big-partner-start-team':
    'Four people around a living room coffee table with tea and sweets: one of them holding open a product catalogue and gesturing at a phone, three boxes of product bottles on the table, friendly attentive conversation, warm afternoon light',
  'big-partner-start-online':
    'A person filming a short video on a phone mounted on a small tripod at a desk, holding up a product bottle to the camera, a ring light, product boxes stacked beside a laptop, cosy home office, daylight from the side',
  'big-partner-expand':
    'A bright meeting room table covered with a full range of product boxes and bottles: an experienced mentor and a newcomer going through a printed catalogue together, notebooks and a phone on the table, daylight',
  'big-partner-expand-leader':
    'A small training session in an airy room: a woman standing beside a flip chart with simple abstract diagrams teaching six people seated in a semicircle, product boxes on a side table, notebooks on laps, bright daylight',
}

/** Расходы (doodads). */
const SCENES_DOODADS = {
  'wt-umnye-chasy':
    "A new smartwatch in an opened box on a kitchen table beside a coffee cup and the old scratched watch it will replace, morning window light",
  'wt-otpusk-more':
    "An open suitcase on a bed with folded summer clothes, sunglasses, sunscreen and printed boarding passes, a beach photograph propped against the wall, bright light",
  'wt-mashina-poluchshe':
    "A newer used car parked in a Russian courtyard beside an older one, keys with a dealership tag on the bonnet, autumn leaves, overcast afternoon",
  'wt-remont-kuhni':
    "A kitchen mid-renovation: new cabinet fronts leaning against the wall, tile samples and a magazine spread of a finished kitchen on the counter, dust sheets on the floor",
  'wt-telefon':
    "A brand new smartphone in its opened box on a desk next to the older phone still switched on, cables and screen protector beside them, cool daylight",
  'wt-abonement':
    "A gym membership card and a fresh pair of training shoes on a bench in a locker room, towel folded beside them, clean bright light",
  'wt-svadba-plemyannika':
    "A wedding gift envelope, a pressed suit on a hanger and polished shoes by the door of a Russian flat, ready for a family celebration, warm evening lamp",
  'wt-kurs':
    "A laptop open on a kitchen table showing a course lesson list, a fresh notebook and pen beside it, cup of tea, evening light",
  'wt-dacha-bania':
    "A newly built wooden banya at a Russian dacha: stacked firewood, steam curling from the chimney, birch branches by the door, snow on the ground, golden late light",
  'wt-umnyi-dom':
    "A living room with smart home devices installed: a wall panel, smart speaker, motorised curtains half open, subtle indicator lights in evening dusk",

  'dd-shtraf-kamera':
    'A man at a kitchen table holding an opened official envelope with a printed grainy photograph of a car on a road, morning coffee beside him, resigned expression, sunlight through the window',
  'dd-sabantuy-gostintsy':
    'A table of Tatar treats being packed into a wicker basket: a pyramid of golden chak-chak honey pastry, triangular baked pastries, a big bag of wrapped sweets; a sunny festival meadow with colourful bunting outside the window',
  'dd-utrennik-v-sadike':
    'A kindergarten party: a cake with candles, balloons, small children in animal costumes, and an adult man in a rabbit costume looking sheepish among them, bright colourful room',
  'dd-prostuda-apteka':
    'A pharmacy counter: a pharmacist handing a paper bag full of medicine boxes to a tired man in a scarf, shelves of plain white boxes behind, clean bright lighting',
  'dd-detsad-doplata':
    'A kindergarten hallway with children’s cubbies full of small jackets: a teacher with a clipboard talking to a parent, a clay modelling table and a door to a small pool visible beyond, bright daylight',
  'dd-smesitel-potek':
    'A plumber kneeling under a kitchen sink with a wrench, water dripping into a plastic bucket, an open toolbox on the tiles, the homeowner standing with folded arms watching',
  'dd-sbor-na-mechet':
    'A neighbour standing in an apartment doorway holding a clipboard with a ruled donation list, a hand passing over plain banknotes; through the window a mosque with a minaret wrapped in repair scaffolding',
  'dd-botinki-rebenku':
    'A children’s shoe shop: a mother fitting new leather boots on a boy sitting on a low bench, shoe boxes stacked around them, bright shop lighting',
  'dd-shinomontazh':
    'A tyre fitting garage on the first snowy day: a queue of cars waiting outside in the sleet, a mechanic mounting a winter tyre on the balancing machine, stacks of tyres, warm garage glow against cold blue light',
  'dd-sbory-k-shkole':
    'A table covered with school supplies — notebooks, pens, rulers, a new backpack, paint set — and a long handwritten list with illegible scribbled lines, a parent’s hands sorting through it, warm lamp light',
  'dd-gosti-iz-derevni':
    'A crowded family kitchen: relatives of three generations packed around a table loaded with food, an open refrigerator standing nearly empty behind them, bags and a suitcase in the hallway, warm evening light',
  'dd-kursy-korana-detyam':
    'A boy sitting cross-legged reading from a large book propped on a carved wooden book rest, an older teacher beside him nodding; a calm study room with carpets and soft daylight, the pages seen at an angle and not legible',
  'dd-evakuator':
    'A tow truck winching a car up onto its bed on a city street, a man running toward it waving his arm, wet asphalt, ordinary urban daylight',
  'dd-kot-zabolel':
    'A veterinary examination table with a very plump unbothered cat sitting on it, a vet with a stethoscope listening and a worried owner behind, bright clinical light',
  'dd-podarok-na-nikah':
    'A wedding banquet table: an envelope being handed over between guests, flowers and trays of sweets, elegantly dressed people, warm hall lighting',
  'dd-uraza-bayram-podarki':
    'A festive morning at home: children unwrapping new clothes, a tray of envelopes and sweets on the table, family gathered around in their best clothes, bright warm light',
  'dd-stiralka-slomalas':
    'A repairman sitting on a bathroom floor with a washing machine pulled out and its back panel removed, parts laid out on a towel, a puddle on the tiles, the owner watching from the doorway',
  'dd-den-rozhdeniya-v-kafe':
    'A long café table with seventeen guests celebrating a birthday: a cake being carried in, balloons tied to chairs, plates everywhere, warm restaurant lighting',
  'dd-razbil-ekran':
    'A hand holding a smartphone with a badly shattered screen; on the desk beside it an unopened protective phone case still sealed in its packaging, warm desk lamp light',
  'dd-repetitor-matematika':
    'A tutor and a teenager at a kitchen table working through geometry on paper with a ruler and a compass, an open exercise book covered in simple line diagrams, evening lamp light',
  'dd-stomatolog-plomba':
    'A dental surgery: a patient reclined in the chair, dentist and assistant working under a bright overhead lamp, a clean modern clinic in soft focus behind',
  'dd-akvapark-s-detmi':
    'A busy indoor water park: colourful curving slides, children splashing in a shallow pool, a father carrying a stack of towels, humid bright light and glass roof',
  'dd-godovshchina-svadby':
    'A candlelit restaurant table for two: a bouquet of roses, a couple raising glasses of tea to each other, warm intimate lighting, blurred restaurant behind',
  'dd-iftar-na-rodnyu':
    'A long table set for twenty at sunset: an enormous platter of rice pilaf in the middle, dates and tea, a large family seated and reaching for food, golden light pouring through the window',
  'dd-kurtka-na-zimu':
    'A clothing shop: a man trying on a heavy winter parka in front of a tall mirror while his wife looks on approvingly, racks of coats around, bright shop lighting',
  'dd-zamena-akkumulyatora':
    'A brutally cold winter morning in a snowy courtyard: a man carrying a heavy car battery toward his car, jumper cables draped over a neighbour’s open bonnet, breath steaming, deep blue cold light',
  'dd-novye-ochki':
    'An optician’s shop: a man trying on new spectacles in front of a small mirror, walls of frame displays behind him, an assistant adjusting the temple arms, bright clean light',
  'dd-noutbuk-zalili':
    'A laptop turned upside down on a kitchen towel with a tipped-over cup of tea beside it, a spreading puddle, a child’s homework notebook pushed aside, a father blotting with paper towels',
  'dd-puhovik-zhene':
    'A woman trying on a long warm down coat in a shop, turning in front of a mirror, her husband holding the empty hanger, a snowy street visible through the shop window',
  'dd-samokat-synu':
    'A boy standing proudly with a brand new kick scooter in a courtyard, three friends on their own scooters around him, panel houses behind, warm summer evening light',
  'dd-kostyum-na-vypusknoy':
    'A teenage boy in a new fitted suit standing on a low platform while a tailor pins the sleeve, mirrors on three sides, a proud mother watching from a chair, menswear shop',
  'dd-velosiped-dochke':
    'A girl receiving a new bicycle with a ribbon bow tied to the handlebars in a courtyard, parents watching from a bench, spring daylight and fresh green trees',
  'dd-telefon-rebenku':
    'A child unboxing a new smartphone at the kitchen table, packaging and film peeled aside, parents watching with mixed feelings from across the table, warm daylight',
  'dd-koronka-na-zub':
    'A dentist at a desk showing a patient a small ceramic dental crown held in tweezers next to a plaster model of teeth, the patient wincing slightly, modern clinic behind',
  'dd-baran-na-kurban':
    'A rural morning: a healthy well-fed ram standing in a clean straw-bedded pen while a farmer and a buyer look it over, wooden fence, green meadow and low hills, soft morning light',
  'dd-abonement-v-zal':
    'A modern gym: rows of treadmills and racks of weights in the background, a man at the reception desk signing up with a gym bag on his shoulder, bright airy space',
  'dd-putevka-v-lager':
    'A summer camp departure: children boarding a bus with backpacks and suitcases, parents waving from the kerb, tall pine forest behind, sunny morning',
  'dd-televizor-sgorel':
    'A living room with a large dead black television screen, a grandfather and two grandchildren sitting on the sofa looking disappointed, remote control in hand, warm lamp light',
}

/** Быстрая дорожка — бизнесы. */
const SCENES_FAST_BIZ = {
  'fast-biz-coffee-ufa':
    'A cosy speciality coffee shop with a mosque and its minaret visible through the big window: a barista pulling an espresso shot, guests at wooden tables after Friday prayer, warm daylight and plants',
  'fast-biz-echpochmak-kzn':
    'A busy bakery counter: trays of golden triangular meat pastries, a queue of customers, a baker shaping dough in the open kitchen behind, warm ovens and steam',
  'fast-biz-carwash-ufa':
    'A self-service car wash bay in winter: a car covered in white foam, a man in a jacket with the pressure lance, high snowbanks around, bright floodlights against deep blue dusk',
  'fast-biz-halal-cafe-kzn':
    'A stylish restaurant dining room: a huge cast-iron kazan of rice pilaf being served at a full table, other tables occupied, warm pendant lights over dark wood',
  'fast-biz-sewing-chelny':
    'A workwear sewing workshop: rows of industrial sewing machines with seamstresses at work, stacks of folded orange and navy overalls, bolts of fabric on racks, bright practical lighting',
  'fast-biz-it-artel-innopolis':
    'A small modern software office in a new technology town: four developers at desks with monitors showing abstract colourful interface blocks, a whiteboard of simple boxes and arrows, floor-to-ceiling windows, daylight',
  'fast-biz-water-rodnik':
    'A water delivery operation: two vans loaded with large blue water bottles, a driver carrying two bottles into an office entrance, pallets of bottles stacked behind, crisp morning light',
  'fast-biz-glamping-altai':
    'A glamping site in the Altai mountains: canvas geodesic domes on an alpine meadow with snow-capped peaks behind, a fire pit and wooden deck chairs, mist in the valley, golden morning light',
  'fast-biz-frozen-food-chelny':
    'A clean food production plant: workers in white coats and hairnets forming dumplings along a stainless steel line, trays of frozen dumplings on racks, bright hygienic lighting',
  'fast-biz-dental-kzn':
    'A modern dental clinic: three treatment chairs in a bright open room, staff in scrubs working, a waiting lounge with plants visible through a glass wall',
  'fast-biz-autoservice-ufa':
    'A car service workshop: two cars raised on lifts with mechanics working underneath, tool cabinets and an engine crane, tyres stacked along the wall, bright shop lighting',
  'fast-biz-madrasa-school':
    'A private school classroom: children at wooden desks, a teacher at a board covered with simple abstract diagrams, a shelf of books along the wall, big windows and airy daylight',
  'fast-biz-logistics-chelny':
    'A truck yard at dawn: ten long-haul trucks with trailers lined up in a row, a driver doing a walk-around check with a torch, warehouse loading doors behind, low golden light',
  'fast-biz-goat-farm-bashkiria':
    'A goat farm with a small cheese dairy: goats in a clean straw-bedded barn, and beside it a cheesemaker turning wheels of cheese on wooden cellar shelves, rolling green hills through the open door',
  'fast-biz-meat-shops-kzn':
    'A butcher stall in a covered market: a butcher in a white apron cutting meat on a thick block, a neat chilled display case, hanging scales, customers queueing, warm market light',
}

/** Быстрая дорожка — совместные предприятия. */
const SCENES_FAST_VENTURE = {
  'fast-venture-drill-siberia':
    'An oil drilling rig on a frozen Siberian plain in extreme cold: a steel derrick lit by floodlights, steam billowing from equipment, workers in heavy fur-hooded parkas, deep blue polar twilight over snow',
  'fast-venture-yamal-crew':
    'An Arctic shift camp: modular cabins raised on stilts above the snow, heavy tracked machinery, a crew in orange parkas gathered by a truck, low red polar sun on the horizon',
  'fast-venture-startup-airat':
    'Two friends in a small rented office late at night: one leaning forward excitedly pointing at a laptop showing a simple map interface with coloured pins, an empty pizza box, a whiteboard of sketches, one desk lamp',
  'fast-venture-export-uae':
    'Refrigerated shipping containers being loaded onto a cargo aircraft at a Gulf airport at sunrise: a forklift lifting a container, workers in high-visibility vests checking a clipboard, warm desert light',
}

/** Мечты (в данных у них нет id — ключ по точному названию). */
const SCENES_DREAMS = {
  'Хадж всей семьёй': {
    slug: 'dream-hajj-family',
    scene:
      'A family of five walking together across a vast white marble courtyard among many pilgrims in simple white clothing, tall arcades and lamp posts around the edges, soft golden early light, serene and unhurried',
  },
  'Библиотека в родном селе': {
    slug: 'dream-village-library',
    scene:
      'A bright new village library: warm wooden shelves full of books, a boy of about thirteen curled up in a tall window seat reading, sunlight falling across the wooden floor',
  },
  'Приют для животных': {
    slug: 'dream-animal-shelter',
    scene:
      'An animal shelter yard: a person greeted by a dozen happy dogs bounding toward them, clean kennels along one side, volunteers with bowls, cats sunning on a porch, bright morning light',
  },
  'Домик в горах Алтая': {
    slug: 'dream-altai-cabin',
    scene:
      'A small wooden cabin standing alone on a high alpine meadow in the Altai mountains: no power lines anywhere, mist filling the valley below, snow-capped peaks beyond, a person on the porch with a cup, dawn light',
  },
  'Кругосветное путешествие': {
    slug: 'dream-world-trip',
    scene:
      'A traveller with a single well-worn backpack standing at a stone overlook above a foreign coastal city, a ferry crossing the bay far below, warm late afternoon light, wide horizon',
  },
  'Студия звукозаписи': {
    slug: 'dream-recording-studio',
    scene:
      'A professional recording studio: a large mixing console in the foreground, a vocal booth behind thick glass where a young singer stands at the microphone, warm wooden acoustic panels, soft red indicator light',
  },
  'Фонд помощи сиротам': {
    slug: 'dream-orphan-fund',
    scene:
      'A bright hall where about forty children sit at long tables having a meal while volunteers serve, big windows flooding the room with daylight, cheerful and dignified atmosphere',
  },
  'Сады и своя сокодельня': {
    slug: 'dream-orchard-juicery',
    scene:
      'An apple orchard in late summer with a small juice pressing workshop: crates heaped with apples, a wooden press, rows of glass bottles of amber juice lined up on a table, sunlight through the leaves',
  },
  'Ранчо с лошадьми и конный клуб': {
    slug: 'dream-horse-ranch',
    scene:
      'A horse ranch at sunrise: a long wooden stable, horses standing in a paddock, one horse nuzzling a person’s shoulder over the fence, dew on the grass, golden low light',
  },
  Суперкар: {
    slug: 'dream-supercar',
    scene:
      'A low sleek supercar parked on cobblestones in a quiet courtyard on a bright morning, glossy deep paint catching the light, a person standing beside the open door with keys in hand',
  },
  'Дом у моря': {
    slug: 'dream-seaside-house',
    scene:
      'A wide terrace of a white stone house overlooking the sea: linen curtains lifting in the breeze, a breakfast table laid for two, olive trees at the edge, bright warm morning and open horizon',
  },
  'Свой самолёт и лицензия пилота': {
    slug: 'dream-airplane-pilot',
    scene:
      'A small private propeller aircraft standing on a grass airfield at sunrise, its owner in a pilot headset doing the pre-flight walk-around, an open hangar behind, long golden light across the grass',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Сборка списка работ
// ─────────────────────────────────────────────────────────────────────────────

function slugFromTicker(sym) {
  return 'stock-' + sym.toLowerCase()
}

function buildJobs() {
  const decks = JSON.parse(fs.readFileSync(DECKS, 'utf8'))
  const jobs = []
  const missing = []
  const manifest = { byId: {}, byTicker: {}, byDream: {} }

  const push = (key, file, scene, group, manifestSlot) => {
    if (!scene) {
      missing.push(key)
      return
    }
    jobs.push({ key, file, scene, group })
    manifestSlot()
  }

  // Малые сделки
  const tickersDone = new Set()
  for (const c of decks.SMALL_DEALS_RU) {
    if (c.kind === 'stock') {
      if (tickersDone.has(c.symbol)) continue
      tickersDone.add(c.symbol)
      const file = slugFromTicker(c.symbol)
      push(c.symbol, file, SCENES_STOCK[c.symbol], 'stock', () => {
        manifest.byTicker[c.symbol] = `/cards/${file}.webp`
      })
    } else {
      push(c.id, c.id, SCENES_SMALL_RE[c.id], 'small-deal', () => {
        manifest.byId[c.id] = `/cards/${c.id}.webp`
      })
    }
  }

  // Большие сделки
  for (const c of decks.BIG_DEALS_RU) {
    const scene = SCENES_BIG_RE[c.id] || SCENES_BIG_BIZ[c.id]
    push(c.id, c.id, scene, 'big-deal', () => {
      manifest.byId[c.id] = `/cards/${c.id}.webp`
    })
  }

  // Расходы
  for (const c of decks.DOODADS_RU) {
    push(c.id, c.id, SCENES_DOODADS[c.id], 'doodad', () => {
      manifest.byId[c.id] = `/cards/${c.id}.webp`
    })
  }

  // Карточки рынка
  for (const c of decks.MARKET_CARDS_RU) {
    push(c.id, c.id, SCENES_MARKET[c.id], 'market', () => {
      manifest.byId[c.id] = `/cards/${c.id}.webp`
    })
  }

  // Быстрая дорожка
  for (const c of decks.FAST_BOARD_RU) {
    if (c.type === 'business' || c.type === 'venture') {
      const scene = SCENES_FAST_BIZ[c.id] || SCENES_FAST_VENTURE[c.id]
      push(c.id, c.id, scene, 'fast-' + c.type, () => {
        manifest.byId[c.id] = `/cards/${c.id}.webp`
      })
    } else if (c.type === 'dream') {
      const d = SCENES_DREAMS[c.name]
      if (!d) {
        missing.push('dream: ' + c.name)
        continue
      }
      jobs.push({ key: c.name, file: d.slug, scene: d.scene, group: 'dream' })
      manifest.byDream[c.name] = `/cards/${d.slug}.webp`
    }
  }

  // Зелёные фоны
  manifest.byBg = manifest.byBg || {}
  for (const [k, scene] of Object.entries(SCENES_GREEN)) {
    push(k, k, scene, 'plateWide', () => {
      manifest.byBg[k] = `/cards/${k}.webp`
    })
  }

  // Фоны, заход второй
  manifest.byBg = manifest.byBg || {}
  for (const [k, scene] of Object.entries(SCENES_BG2)) {
    push(k, k, scene, 'plateWide', () => {
      manifest.byBg[k] = `/cards/${k}.webp`
    })
  }

  // Мир доски без клеток
  manifest.byWorld = manifest.byWorld || {}
  for (const [k, scene] of Object.entries(SCENES_EVENTS)) {
    push(k, `event-${k}`, scene, 'event', () => {
      manifest.byWorld = manifest.byWorld || {}
      manifest.byWorld[k] = `/cards/event-${k}.webp`
    })
  }

  for (const [k, scene] of Object.entries(SCENES_WORLD)) {
    push(k, k, scene, 'plate', () => {
      manifest.byWorld[k] = `/cards/${k}.webp`
    })
  }

  // Фоны под доски
  manifest.byBg = manifest.byBg || {}
  for (const [k, scene] of Object.entries(SCENES_BG)) {
    push(k, k, scene, 'plateWide', () => {
      manifest.byBg[k] = `/cards/${k}.webp`
    })
  }

  // Интерфейсы по референсам Камиля
  manifest.byHud = manifest.byHud || {}
  for (const [k, scene] of Object.entries(SCENES_REF)) {
    push(k, k, scene, 'plateWide', () => {
      manifest.byHud[k] = `/cards/${k}.webp`
    })
  }

  // Полноэкранные интерфейсы
  manifest.byHud = manifest.byHud || {}
  for (const [k, scene] of Object.entries(SCENES_HUD)) {
    push(k, k, scene, 'plateWide', () => {
      manifest.byHud[k] = `/cards/${k}.webp`
    })
  }

  // Городские поля: квадратные и во всю ширину
  manifest.byTable = manifest.byTable || {}
  for (const [k, scene] of Object.entries(SCENES_CITY)) {
    push(k, `table-${k}`, scene, 'plate', () => {
      manifest.byTable[k] = `/cards/table-${k}.webp`
    })
  }
  for (const [k, scene] of Object.entries(SCENES_CITY_WIDE)) {
    push(k, `table-${k}`, scene, 'plateWide', () => {
      manifest.byTable[k] = `/cards/table-${k}.webp`
    })
  }

  // Пять досок на выбор
  manifest.byTable = manifest.byTable || {}
  for (const k of Object.keys(SCENES_TABLE)) {
    push(k, `table-${k}`, SCENES_TABLE[k], 'plate', () => {
      manifest.byTable[k] = `/cards/table-${k}.webp`
    })
  }

  // Подложки доски на сравнение
  manifest.byPlate = manifest.byPlate || {}
  for (const k of Object.keys(SCENES_PLATE)) {
    push(k, `board-${k}`, SCENES_PLATE[k], 'plate', () => {
      manifest.byPlate[k] = `/cards/board-${k}.webp`
    })
  }

  // Полотно доски
  manifest.byBoard = manifest.byBoard || {}
  for (const part of Object.keys(SCENES_BOARD)) {
    push(part, `board-${part}`, SCENES_BOARD[part], 'board', () => {
      manifest.byBoard[part] = `/cards/board-${part}.webp`
    })
  }

  // Обложки колод
  manifest.byDeck = manifest.byDeck || {}
  for (const theme of Object.keys(SCENES_DECKS)) {
    push(theme, `deck-${theme}`, SCENES_DECKS[theme], 'deck', () => {
      manifest.byDeck[theme] = `/cards/deck-${theme}.webp`
    })
  }

  // Клетки-события: одна картинка на тип
  manifest.bySpace = manifest.bySpace || {}
  for (const kind of Object.keys(SCENES_SPACES)) {
    push(kind, `space-${kind}`, SCENES_SPACES[kind], 'space', () => {
      manifest.bySpace[kind] = `/cards/space-${kind}.webp`
    })
  }

  return { jobs, missing, manifest }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ключ OpenAI. Печатать нельзя — только длину при ошибке.
// ─────────────────────────────────────────────────────────────────────────────
function loadApiKey() {
  const fromEnv = (process.env.OPENAI_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const cmd =
    "railway variables --service craft-ai --environment production --kv | grep '^OPENAI_API_KEY=' | cut -d= -f2-"
  const key = execSync(cmd, {
    cwd: path.join(os.homedir(), 'craft-ai'),
    shell: '/bin/bash',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 1 << 20,
  })
    .toString()
    .trim()
  if (!key.startsWith('sk-')) throw new Error('не удалось получить OPENAI_API_KEY из Railway')
  return key
}

// ─────────────────────────────────────────────────────────────────────────────
// Сжатие. sharp в зависимостях проекта нет и тащить его туда не хочется, поэтому
// цепочка: sharp (если вдруг есть) → python3 + Pillow (стоит в системе) → cwebp.
// Без сжатия PNG от модели весит ~1.5 МБ, на 135 карточек это 200 МБ в репозитории.
// ─────────────────────────────────────────────────────────────────────────────
let compressor = null

function pickCompressor() {
  if (compressor) return compressor

  try {
    const sharp = require('sharp')
    compressor = async (buf, dest, width = TARGET_WIDTH) => {
      await sharp(buf)
        .resize({ width: width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 6 })
        .toFile(dest)
    }
    compressor.name_ = 'sharp'
    return compressor
  } catch {
    /* дальше по цепочке */
  }

  const PY = `
import sys
from PIL import Image
src, dst, width, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert("RGB")
w, h = im.size
if w > width:
    im = im.resize((width, round(h * width / w)), Image.LANCZOS)
im.save(dst, "WEBP", quality=q, method=6)
`
  try {
    execFileSync('python3', ['-c', 'from PIL import Image, features; assert features.check("webp")'], {
      stdio: 'ignore',
    })
    compressor = async (buf, dest, width = TARGET_WIDTH) => {
      const tmp = path.join(os.tmpdir(), `fr-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
      fs.writeFileSync(tmp, buf)
      try {
        execFileSync('python3', ['-c', PY, tmp, dest, String(width), String(WEBP_QUALITY)], {
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    }
    compressor.name_ = 'python3+Pillow'
    return compressor
  } catch {
    /* дальше по цепочке */
  }

  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
    compressor = async (buf, dest, width = TARGET_WIDTH) => {
      const tmp = path.join(os.tmpdir(), `fr-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
      fs.writeFileSync(tmp, buf)
      try {
        execFileSync('cwebp', ['-q', String(WEBP_QUALITY), '-resize', String(width), '0', tmp, '-o', dest], {
          stdio: 'ignore',
        })
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    }
    compressor.name_ = 'cwebp'
    return compressor
  } catch {
    /* всё */
  }

  throw new Error('нечем сжимать: нет ни sharp, ни python3+Pillow(webp), ни cwebp')
}

// ─────────────────────────────────────────────────────────────────────────────
// Генерация
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Скользящее окно на минуту: держим не больше `rpm` стартов запросов. */
function makeRateLimiter(rpm) {
  const starts = []
  let chain = Promise.resolve()
  return () => {
    // очередь последовательная — иначе десять воркеров одновременно решат,
    // что окно свободно, и все стартанут разом
    chain = chain.then(async () => {
      for (;;) {
        const now = Date.now()
        while (starts.length && now - starts[0] > 60_000) starts.shift()
        if (starts.length < rpm) {
          starts.push(now)
          return
        }
        await sleep(60_000 - (now - starts[0]) + 400)
      }
    })
    return chain
  }
}

let takeSlot = () => Promise.resolve()

async function generateOne(apiKey, prompt, attempt = 1, size = SIZE) {
  await takeSlot()
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: prompt.slice(0, 4000), size, quality: QUALITY, n: 1 }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400)
    // 429 и 5xx лечатся ожиданием; остальное — наша ошибка, повтор не поможет
    const retryable = res.status === 429 || res.status >= 500
    if (retryable && attempt < 8) {
      // OpenAI прямо пишет «Please try again in 12s» — слушаем его, а не свой таймер
      const hint = /try again in ([\d.]+)s/.exec(body)
      const waitMs = hint ? Math.ceil(Number(hint[1]) * 1000) + 1500 : 5000 * attempt
      await sleep(waitMs)
      return generateOne(apiKey, prompt, attempt + 1, size)
    }
    throw new Error(`OpenAI ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  const json = await res.json()
  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('пустой ответ модели (нет b64_json)')
  return Buffer.from(b64, 'base64')
}

function fmtKB(bytes) {
  return (bytes / 1024).toFixed(0) + ' КБ'
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.split('=').slice(1).join('=') : def
  }
  const dry = argv.includes('--dry')
  const force = argv.includes('--force')
  const only = arg('only', '')
  const limit = Number(arg('limit', '0')) || 0
  const rpm = Math.max(1, Number(arg('rpm', String(RPM_DEFAULT))) || RPM_DEFAULT)
  // потока держим на один больше лимита: пока пятый ждёт окно, остальные качают ответ
  const concurrency = Math.max(1, Math.min(10, Number(arg('concurrency', String(rpm))) || rpm))
  takeSlot = makeRateLimiter(rpm)

  const { jobs, missing, manifest } = buildJobs()
  if (missing.length) {
    console.log(`⚠️  без сцены (пропущены): ${missing.length}`)
    missing.forEach((m) => console.log('   · ' + m))
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const manifestJson =
    JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest }, null, 1) + '\n'
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), manifestJson)
  // Копия внутри src: из public импортировать нельзя (он вне tsconfig include),
  // а интерфейсу манифест нужен на этапе сборки, а не запросом в рантайме.
  fs.writeFileSync(path.join(ROOT, 'src', 'data', 'card-art.json'), manifestJson)

  let todo = jobs
  if (only) todo = todo.filter((j) => j.file.includes(only) || j.key.includes(only))
  if (!force) todo = todo.filter((j) => !fs.existsSync(path.join(OUT_DIR, j.file + '.webp')))
  if (limit) todo = todo.slice(0, limit)

  const skipped = jobs.length - todo.length
  console.log(`всего карточек: ${jobs.length} · уже есть/отфильтровано: ${skipped} · к отрисовке: ${todo.length}`)
  console.log(`смета: ${(todo.length * RUB_PER_IMAGE).toFixed(2)} ₽ (${RUB_PER_IMAGE} ₽ за картинку)`)
  console.log(`темп: ${rpm} шт/мин, потоков ${concurrency} → примерно ${Math.ceil(todo.length / rpm)} мин`)

  if (dry) {
    todo.forEach((j) => console.log(`   ${j.group.padEnd(13)} ${j.file}`))
    return
  }
  if (!todo.length) {
    console.log('нечего делать')
    return
  }

  const compress = pickCompressor()
  console.log(`сжатие: ${compress.name_} → ${TARGET_WIDTH}px webp q${WEBP_QUALITY}\n`)

  const apiKey = loadApiKey()
  let done = 0
  let failed = 0
  let bytes = 0
  const errors = []

  const queue = [...todo]
  const worker = async () => {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      const dest = path.join(OUT_DIR, job.file + '.webp')
      try {
        // Доске нужен квадратный кадр, остальному — альбомный.
        const size = job.group === 'plateWide' ? SIZE : job.group === 'plate' || job.group === 'board' ? SIZE_SQUARE : SIZE
        const style = job.group === 'plate' || job.group === 'plateWide' || job.group === 'board' ? BOARD_STYLE : STYLE
        const png = await generateOne(apiKey, `${job.scene}. ${style}`, 1, size)
        await compress(png, dest, job.group.startsWith('plate') || job.group === 'board' ? TARGET_WIDTH_BOARD : TARGET_WIDTH)
        const sz = fs.statSync(dest).size
        bytes += sz
        done++
        console.log(`  ✓ [${done + failed}/${todo.length}] ${job.file}  ${fmtKB(sz)}`)
      } catch (e) {
        failed++
        errors.push(`${job.file}: ${e.message}`)
        console.log(`  ✗ [${done + failed}/${todo.length}] ${job.file}  ${e.message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))

  console.log('')
  console.log(`готово: ${done}, ошибок: ${failed}`)
  if (done) console.log(`средний вес: ${fmtKB(bytes / done)} · новые файлы: ${(bytes / 1024 / 1024).toFixed(1)} МБ`)
  console.log(`потрачено: ${(done * RUB_PER_IMAGE).toFixed(2)} ₽`)
  if (errors.length) {
    console.log('\nошибки:')
    errors.forEach((e) => console.log('   · ' + e))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('ФАТАЛЬНО:', e.message)
  process.exit(1)
})
