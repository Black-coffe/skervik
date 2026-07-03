---
domain: fairness
tags: [rng, security, commit-reveal, invariant]
related: [fair-rng-commit-reveal, deterministic-core, rng-stream-map]
last-verified: 2026-07-03
---

# Инвариант seed: никогда не в GameState

Сырое значение `seed` — сервер-секрет, входной параметр `validate()`, **никогда не сохраняется в `GameState`**. Нарушение этого инварианта разрушает fair RNG.

## Почему

`GameState` сериализуется и отправляется клиентам (по websocket или REST). Если в нём окажется `seed`, клиент получит возможность вычислить все будущие броски костей и разрушит всю систему commit-reveal (см. [[fair-rng-commit-reveal]]). Вместо этого в `GameState` хранится только `seedHash = SHA256(seed)` — необратимый коммит, открытый до партии.

## Как это работает

- **`validate(state, intent, playerId, seed)` (validate.ts, строка 195)**: `seed` передаётся как 4-й параметр на вход, никогда не читается из `state`.
- **Случайность берётся от `seed + streamIndex`**: `rollDie(seed, gameplayStreamIndex(state.eventIndex, slot))` — **чистое индексирование** в поток (rng.ts, no mutable generator state).
- **События записывают только факты**: `dieA`, `dieB`, `total`, `grants`, `bank` — результаты, скомпилированные один раз в `validate` и путешествующие как readonly в событиях (types.ts).

## Как ловить нарушения при ревью

1. **Никогда** на `GameState` или её поля не должно быть ключа `seed`, `rawSeed`, `prng`, `rngState`.
2. **Никакой** RNG-вызов (не `rollDie`, не `shuffle`) не должен без explicit `streamIndex` — если видишь `Math.random()` или `Date.now()` в core, это нарушение ADR-0003.
3. **`seedHash` на `GameState` — OK**, это необратимо (она же в типе, types.ts строка 102).
4. **Проверь воркер-сторию**: если добавляется новое случайное событие (S1.2.2, S1.3.1 и далее), seed всегда передаётся параметром, новый draw добавляется в `GAMEPLAY_SLOT` (validate.ts) или `BOARD_GEN_STREAM` (boardgen.ts), результат — в event как readonly факт.

## Ссылка

Fix-plan A1 (commit 49fcbb5): `seed` → 4-й параметр `validate`, никогда не в GameState.
