# Brief — verbatim user request (2026-08-17)

Owner's words in session (Claude Code, 2026-08-17), deciding what happens after
S2.1.7b merged and vulyk v0.7.0 shipped:

> То мы ждем по катане или что-то делаем?

Queen proposed four options; the owner selected this one (option text Queen-authored,
owner-accepted verbatim as the scope):

> M2-гейт аудит: Прогнать «закрытие M2» через новый /vulyk-plan: brief →
> briefing-вопросы → стори → trace-check. Внутри: сверка всех пунктов M2-гейта,
> per-profile full-match E2E если чего-то не хватает, обновление стейл-статусов 7a/7b.

The standing requirement being audited — the M2 GATE as written in
`docs/specs/m2-mode-platform/plan.md` (owner-approved milestone plan):

> **M2 GATE (all must hold):** Classic/Balanced/Blitz all playable + seed-verifiable;
> 2–6 players; single + multiplayer; adaptive duration keeps matches ≤60 min; catch-up
> mechanics live & profile-gated; reconnect + bot-fill robust (no karmic bans);
> matchmaking + lobby + presence (Redis); heuristic bots ×3; accounts (OAuth + guest) +
> GDPR; every new user-facing string RU/UA/EN; CI green incl. a per-profile full-match
> E2E.

## Answers
<!-- briefing answers appended verbatim below -->

**Q1 (2026-08-17):** M2-гейт требует «presence (Redis)», но S2.5.1 Redis отложен до M5
(один VPS на декабрьскую альфу, in-memory presence). Как поступаем с этим пунктом гейта?

> Амендить гейт — переписать пункт на «in-memory presence (Redis → M5)»

**Q2 (2026-08-17):** Гейт требует «accounts (OAuth + guest)», но S2.6.2b OAuth отложен —
нужны OAuth-приложения владельца (client ID/secret). Guest-JWT уже в проде (S2.6.2a).
Что с OAuth в гейте?

> Амендить: guest сейчас, OAuth ← креды — переписать пункт на «guest JWT в M2; OAuth —
> когда владелец зарегистрирует приложения (S2.6.2b)»

**Q3 (2026-08-17, после рекона):** adaptive duration реализован в core, но не подключён
(ноль вызовов из server/client). Подключить живьём, только предупреждать в лобби, или
перенести в M3?

> Подключить живьём — GameRoom применяет computeAdaptiveDuration на генезисе матча
> (детерминированно от числа игроков) + лобби показывает оценку длительности и
> предупреждение (3 новых i18n-ключа ×3 локали)

**Q4 (2026-08-17, после lead-review BLOCK):** адаптивные пороги для expanded вышли
8 VP (5p) / 6 VP (6p) из некалиброванной эвристики; на 6 VP матч выигрывается без
единой постройки. Кламп пола ≥8, сим-свип сначала, или откат вайринга до M3?

> Кламп пола ≥ 8 VP — адаптация не опускает порог побед ниже 8; expanded 5p и 6p
> играют до 8 VP; калибровка эстиматора — M3 с телеметрией

**Q5 (2026-08-17, после re-review, находка N1):** с полом 8 шестиместный Grand Chart
оценивается в 67,6 мин — заголовок гейта «adaptive duration keeps matches ≤60 min» для
него ложен, и об этом размене владельца не спрашивали. Амендировать?

> Амендить с исключением — ≤60 мин для всех столов, кроме 6-местного Grand Chart: там
> порог снижен до пола 8 и игрок предупреждён в лобби; вписывание в 60 мин — после
> M3-калибровки эстиматора телеметрией
