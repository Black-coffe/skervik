---
domain: gameplay
tags: [rule-profiles, balance, catch-up, honesty, m2]
related: [deterministic-core, production-rules]
last-verified: 2026-07-09
---

# Rule Profiles: что реально делает каждый пресет

`RuleProfile` — единственный источник правды для движка (`packages/core/src/ruleProfile.ts`).
Этот документ фиксирует **честные** claims про четыре текущих пресета (`classic | balanced |
blitz | twoPlayer`) — только то, что доказано кодом или измерением, без переобещаний. Триггер:
S2.2.6 ретрактнула S2.2.5's confounded comeback-метрику (см. `S2.2.5a-fix-comeback-metric.md`) —
H2/H3 и вывод про `hiddenVp` были построены на артефакте, а не на реальном эффекте.

## Classic — эталон

`vpToWin: 10`, `randomness: 'dice'` (независимый 2d6 каждый ход), все `catchUp`-флаги выключены.
**Byte-frozen**: golden replay fixture и КАЖДАЯ seed-верификация (`GET /matches/:id/verify`)
зависят от точных литералов Classic — их нельзя менять без разрыва существующих матчей/реплеев.

## Balanced — снижает ТОЛЬКО дисперсию костей

`randomness: 'balanced_deck'` (S2.1.2): числа тянутся БЕЗ возврата из 36-исходной колоды 2d6
вместо независимого броска каждый ход — структурно невозможна длинная серия одного числа или
засуха ресурса внутри одного 36-тиража цикла.

**Что измерено, а что нет:** balance-sim (S2.2.5, метрика исправлена в S2.2.5a) нашёл **отсутствие
измеримого эффекта на runaway-leader** — сравнение Balanced/Classic корректно (оба `vpToWin: 10`,
matched-cut контраст чистый), сигнала просто нет. Дисперсия костей и runaway-leader — ДВЕ РАЗНЫЕ
боли с разными лекарствами. **Balanced НЕ является catch-up режимом** и не должен так описываться
в UI/маркетинге.

## Blitz — короче, не честнее

`vpToWin: 8` (движок уже читает этот knob — live config, матч реально заканчивается раньше) +
вдвое ужатые turn-timers (S2.1.4: ~30s/60s/30s/30s против Classic 60s/120s/45s/45s).

**Что измерено, а что нет:**
- **Timers НИКОГДА не были проверены измерением** — bot-harness action-capped, не wall-clocked;
  симулятор не знает про часы. Числа Blitz в balance-sim изолируют только `vpToWin: 8`.
- **Corrected matched-cut метрика показывает МЕНЬШЕ камбэков у Blitz, чем у Classic**, в каждом
  trailing-count страте (короче матч → раньше кончаются VP → тот, кто уже лидировал, чаще
  выигрывает). Blitz — рычаг ТЕМПА, не рычаг catch-up, и не должен описываться как второе.

## `catchUp.hiddenVp` — информационный, не механический эффект

Когда `true`: VP от dev-карт исключены из порога victory/trigger (читается только PUBLIC VP), но
по-прежнему учитываются в финальном табло. **Это information-hiding механика** — её ценность
социальная (соперники не видят, против кого объединяться), а не арифметическая.

Bot-когорта в balance-sim читает ПОЛНЫЙ `GameState` (включая скрытые VP) — значит, социальный
эффект принципиально НЕИЗМЕРИМ этим harness'ом при ЛЮБОМ размере выборки. Ранний вывод S2.2.5
"`hiddenVp` измеримо ВРЕДИТ camebacks" был артефактом confounded-метрики и ретрактнут в S2.2.5a.
Из места `hiddenVp` внутри `CatchUpProfile` **нельзя** делать вывод, что включение флага помогает
ИЛИ вредит отстающим игрокам — этот вопрос не отвечаем данным инструментом.

## Три коренностных guard'а (S2.2.6)

`validateRuleProfile` (запускается один раз, над ВСЕМ `PROFILE_REGISTRY`, при инициализации
модуля — НЕ на каждый `reduce`/`validate` вызов) бросает исключение при импорте, если профиль
несогласован:

- **G1** — `catchUp.eventTilesInterval >= 1` (0 делает cadence-проверку `validate.ts` навсегда
  `false` — мёртвый флаг без крэша).
- **G2** — `catchUp.eventTiles === true` требует `catchUp.robinHood === true` (иначе выданные
  poverty-токены никто не может потратить — `spendPovertyToken` имеет единственную точку вызова,
  закрытую за `profile.catchUp.robinHood &&`).
- **G3** — `1 <= catchUp.robinHoodExchangeRate < bankTrade.baseRate` (скидка обязана быть лучше
  базовой ставки банка, иначе это наценка, а не catch-up; НЕ обязана бить 2:1 порт — там сработает
  обычный путь без траты токена).

Ни один из трёх guard'ов не меняет ни один шипящий пресет — все четыре (`classic`, `balanced`,
`blitz`, `twoPlayer`) уже проходят их без изменений.

## Ссылки

- Ретракция confounded-метрики: `docs/specs/m2-mode-platform/S2.2.5a-fix-comeback-metric.md`
- Guard-story: `docs/specs/m2-mode-platform/S2.2.6-honest-presets-and-guards.md`
- `[[deterministic-core]]`, `[[production-rules]]`
