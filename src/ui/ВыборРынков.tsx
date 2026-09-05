import { РЫНКИ, ВСЕ_РЫНКИ, type Рынок } from '../engine/рынки'

/**
 * Галочки стран, из которых собирается колода.
 *
 * 🔴 ЗАЧЕМ. Две просьбы Камиля оказались одной: «выбор рынков и стран перед
 * началом» и «версия колоды без российских активов». Снял галочку с России —
 * получил вторую. Отдельной колоды не заводим: она разъедется с основной при
 * первой же правке.
 *
 * 🔴 ХОТЯ БЫ ОДНА СТРАНА. Пустой выбор — это стол без единой сделки: снять
 * последнюю галочку нельзя, кнопка просто не отзовётся. Так же и с
 * ограничением снизу: играть одной страной можно, и колода это выдерживает
 * (проверено `markettest`), но человек должен видеть, сколько сделок ему
 * осталось, — поэтому счётчик стоит рядом с галочками, а не прячется.
 */
export function ВыборРынков({
  выбор,
  onChange,
  можно = true,
  счёт,
}: {
  /** Отмеченные страны. `undefined` — все. */
  выбор: Рынок[] | undefined
  onChange: (в: Рынок[] | undefined) => void
  /** Хозяин стола правит, остальные смотрят. */
  можно?: boolean
  /** Сколько сделок останется — считает вызывающий, у него есть колода. */
  счёт?: { малых: number; крупных: number }
}) {
  const отмечено = new Set<Рынок>(выбор ?? ВСЕ_РЫНКИ)

  function щёлк(к: Рынок) {
    if (!можно) return
    const н = new Set(отмечено)
    if (н.has(к)) {
      if (н.size === 1) return // последнюю не снимаем: колода не может быть пустой
      н.delete(к)
    } else {
      н.add(к)
    }
    const список = ВСЕ_РЫНКИ.filter((x) => н.has(x))
    onChange(список.length === ВСЕ_РЫНКИ.length ? undefined : список)
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Страны в колоде
        </span>
        {счёт && (
          <span className="text-[11px] text-[var(--muted)]">
            останется сделок: {счёт.малых + счёт.крупных}
          </span>
        )}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {РЫНКИ.map((р) => {
          const есть = отмечено.has(р.код)
          return (
            <button
              key={р.код}
              type="button"
              onClick={() => щёлк(р.код)}
              disabled={!можно}
              aria-pressed={есть}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
                есть
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-[var(--line)] bg-[var(--panel-2)] opacity-60'
              } ${можно ? 'hover:border-emerald-500/60' : 'cursor-default'}`}
            >
              <span
                className={`mt-[2px] grid size-4 shrink-0 place-items-center rounded border text-[10px] font-bold ${
                  есть
                    ? 'border-emerald-500 bg-emerald-500 text-emerald-950'
                    : 'border-[var(--line)] text-transparent'
                }`}
              >
                ✓
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight">{р.имя}</span>
                <span className="block truncate text-[11px] leading-tight text-[var(--muted)]">
                  {р.города}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
        Акции, партнёрский бизнес и цифровое дело остаются при любом выборе — у них нет страны.
      </p>
    </div>
  )
}
