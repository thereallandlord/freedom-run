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
const RUB_PER_IMAGE = 0.37 // замер по факту: low ≈ 158 output-токенов × $30/1M × ~78 ₽/$

const TARGET_WIDTH = 900
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
    compressor = async (buf, dest) => {
      await sharp(buf)
        .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
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
    compressor = async (buf, dest) => {
      const tmp = path.join(os.tmpdir(), `fr-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
      fs.writeFileSync(tmp, buf)
      try {
        execFileSync('python3', ['-c', PY, tmp, dest, String(TARGET_WIDTH), String(WEBP_QUALITY)], {
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
    compressor = async (buf, dest) => {
      const tmp = path.join(os.tmpdir(), `fr-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
      fs.writeFileSync(tmp, buf)
      try {
        execFileSync('cwebp', ['-q', String(WEBP_QUALITY), '-resize', String(TARGET_WIDTH), '0', tmp, '-o', dest], {
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

async function generateOne(apiKey, prompt, attempt = 1) {
  await takeSlot()
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: prompt.slice(0, 4000), size: SIZE, quality: QUALITY, n: 1 }),
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
      return generateOne(apiKey, prompt, attempt + 1)
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
        const png = await generateOne(apiKey, `${job.scene}. ${STYLE}`)
        await compress(png, dest)
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
