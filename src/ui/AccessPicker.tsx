/**
 * Кто нашёл — тот и решает, кого пускать в сделку и на каких условиях.
 *
 * 🔴 Зачем это вообще. Раньше любой игрок мог купить ту же бумагу по той же
 * цене без спроса, и удачный ход не стоил ничего. За офлайновым столом так не
 * играют: там спрашивают разрешения и договариваются. Камиль вспомнил это по
 * живой игре — «не каждый может войти по такой же цене».
 *
 * Три решения по порядку, и все считаемые, без «договорились на словах»:
 *   1. пускать или нет
 *   2. кого — всех или выбранных (за столом можно объединяться)
 *   3. на каких условиях — доля с прибыли, плата за вход или бесплатно
 */
import { useState } from 'react'
import type { DealAccess, Seat, Table } from '../engine/types'
import type { TableEvent } from '../engine/events'
import { money } from './PlayerPanel'
import { HalalNote } from './HalalNote'

const CLOSED: DealAccess = { mode: 'closed', allow: [], terms: { kind: 'free' } }

export function AccessPicker({
  table,
  seat,
  access,
  dispatch,
}: {
  table: Table
  seat: Seat
  access: DealAccess | undefined
  dispatch: (e: TableEvent) => void
}) {
  const others = table.seats.filter((s) => s.id !== seat.id && !s.outOfGame && s.track === 'rat')
  const [pct, setPct] = useState(20)
  const [fee, setFee] = useState(20_000)
  const [picked, setPicked] = useState<string[]>([])
  const [openTerms, setOpenTerms] = useState(false)
  const [termKind, setTermKind] = useState<'profitShare' | 'fee' | 'free'>('profitShare')

  if (!others.length) return null
  const a = access ?? CLOSED
  const set = (next: DealAccess) => dispatch({ type: 'SET_ACCESS', access: next })

  // Решение принято — показываем его коротко, с возможностью передумать.
  if (access) {
    const how =
      a.terms.kind === 'free'
        ? 'без условий'
        : a.terms.kind === 'fee'
          ? `плата за вход ${money(a.terms.amount)}`
          : `${a.terms.pct}% с вашей прибыли при продаже`
    const who =
      a.mode === 'closed'
        ? 'Вход закрыт — находка только ваша'
        : a.mode === 'open'
          ? `Вход открыт всем · ${how}`
          : `Пускаете: ${a.allow
              .map((id) => table.seats.find((s) => s.id === id)?.name)
              .filter(Boolean)
              .join(', ')} · ${how}`
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[12px]">
        <span>{who}</span>
        <button
          onClick={() => {
            // Снимаем решение целиком, а не подменяем его на «никого не пускаю».
            setOpenTerms(false)
            dispatch({ type: 'SET_ACCESS', access: null })
          }}
          className="ml-2 underline decoration-dotted underline-offset-2 opacity-70 hover:opacity-100"
        >
          передумать
        </button>
      </div>
    )
  }

  return (
    /*
      🔴 Блок отделён от самой сделки. Это ДРУГОЙ вопрос: сделку ты решаешь
      про себя, а вход — про соседей по столу. Раньше он шёл сплошняком следом
      за кнопками покупки, и человек видел пять почти одинаковых кнопок подряд.
    */
    <div className="space-y-2 rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel-2)] p-3">
      <p className="caps text-[10px] font-bold text-[var(--muted)]">Условия для других игроков</p>
      <p className="text-[12px] font-bold">Пускать остальных в эту сделку?</p>
      <p className="text-[11px] leading-snug text-[var(--muted)]">
        Карта выпала вам — вы решаете, войдёт ли кто-то ещё и что вам за это будет.
      </p>
      {/*
        🔴 «НЕПОНЯТНО, ЧТО ИМЕННО ОТКРЫВАЕТ ОТКРЫТЬ ВХОД — ПОКУПКУ ИЛИ И
        ПРОДАЖУ ТОЖЕ». Живой вопрос за столом. Открывается ровно одно: право
        КУПИТЬ этот актив себе, на свои деньги. Дальше он его собственный —
        продаёт когда хочет и кому хочет, спрашивать не надо.
      */}
      <p className="mb-2 text-[11.5px] leading-snug text-[var(--muted)]">
        Открывается только право <b>купить</b> этот актив себе и на свои деньги. Дальше он
        целиком его: продаст когда захочет, разрешения не спросит.
      </p>

      {!openTerms ? (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => set(CLOSED)} className="btn-quiet">
            Никого не пускаю
          </button>
          <button onClick={() => setOpenTerms(true)} className="btn-quiet border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
            Пустить в покупку
          </button>
        </div>
      ) : (
        <>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Кого пускаем
            </div>
            <div className="flex flex-wrap gap-1.5">
              {others.map((o) => {
                const on = picked.includes(o.id)
                return (
                  <button
                    key={o.id}
                    onClick={() =>
                      setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id]))
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                      on ? 'border-emerald-500 bg-emerald-500/15' : 'border-[var(--line)]'
                    }`}
                  >
                    <span style={{ color: o.color }}>●</span> {o.name}
                  </button>
                )
              })}
              <button
                onClick={() => setPicked(others.map((o) => o.id))}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11.5px]"
              >
                всех
              </button>
            </div>
          </div>

          <div>
            {/*
              🔴 Сначала ВЫБИРАЕМ, что получаем, потом настраиваем сумму, и
              только затем подтверждаем. Раньше здесь стояли два ползунка, у
              каждого своя кнопка, и нажатие на кнопку одновременно выбирало
              условие и применяло его — понять, что выбрано сейчас, было
              нельзя вовсе.
            */}
            <div className="mb-1 caps text-[10px] font-bold text-[var(--muted)]">
              Что вы за это получаете
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['profitShare', 'Доля с прибыли'],
                  ['fee', 'Плата за вход'],
                  ['free', 'Ничего'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTermKind(k)}
                  className={`rounded-lg border px-2 py-2 text-[11.5px] font-semibold leading-tight transition ${
                    termKind === k
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-[var(--line)] text-[var(--muted)] hover:border-emerald-500/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {termKind === 'profitShare' && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={5}
                    value={pct}
                    onChange={(e) => setPct(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="tabnum w-14 text-right text-[15px] font-bold">{pct}%</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-[var(--muted)]">
                  Отдаст {pct}% СВОЕЙ прибыли, когда будет продавать. Продаст в минус — не
                  отдаст ничего.
                </p>
                {/*
                  🔴 ЧЕСТНАЯ ПОМЕТКА, А НЕ ЗАПРЕТ. Разбор шести правовых
                  оснований показал: вопрос спорный, и большинство учёных
                  против — не из-за процента, а из-за того, что за платой нет
                  ни денег, ни труда, ни принятого убытка. Механику пока
                  оставляем; человек должен решать, зная это.
                */}
                <div className="mt-2">
                  <HalalNote topic="dolyaZaVhod" />
                </div>
              </div>
            )}

            {termKind === 'fee' && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={10_000}
                    max={300_000}
                    step={10_000}
                    value={fee}
                    onChange={(e) => setFee(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="tabnum w-24 text-right text-[15px] font-bold">{money(fee)}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-[var(--muted)]">
                  Заплатит {money(fee)} сразу при входе, сверх цены покупки. Дальше никаких
                  хвостов.
                </p>
              </div>
            )}

            {termKind === 'free' && (
              <p className="mt-2 text-[10.5px] leading-snug text-[var(--muted)]">
                Пустите просто так — иногда это выгоднее: сосед запомнит.
              </p>
            )}

            <button
              disabled={!picked.length}
              onClick={() =>
                set({
                  mode: picked.length === others.length ? 'open' : 'chosen',
                  allow: picked,
                  terms:
                    termKind === 'profitShare'
                      ? { kind: 'profitShare', pct }
                      : termKind === 'fee'
                        ? { kind: 'fee', amount: fee }
                        : { kind: 'free' },
                })
              }
              className="btn-primary mt-2.5 w-full disabled:opacity-40"
            >
              {picked.length ? 'Открыть вход' : 'Сначала выберите, кого пускать'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
