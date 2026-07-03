---
domain: fairness
tags: [rng, security, commit-reveal, invariant]
related: [fair-rng-commit-reveal, deterministic-core, rng-stream-map, server-authority]
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

## На сервере: приватное поле room.#seed (S1.4.1)

Комната Colyseus (`packages/server/src/room/GameRoom.ts`) хранит сырой seed в приватном JS-поле `#seed` (настоящий приватный, не просто соглашение):

1. **Генерация:** `onCreate` — `#seed = randomBytes(32).toString('hex')` (Node.js crypto, только серверная доступность).
2. **Никогда не на GameState:** `GameState` создаётся с `seedHash` (SHA-256), а `#seed` остаётся в памяти комнаты ТОЛЬКО.
3. **Передача в validate:** `validate(gameState, intent, playerId, this.#seed)` — seed идёт 4-м параметром.
4. **Никогда не в @colyseus/schema:** `RoomSchema` проецирует только `seedHash`, `phase`, `currentPlayerId`, `seats` — никогда не `seed`.
5. **Никогда не в эфир:** `state.snapshot` отправляет `GameState` (где только `seedHash`); seed не бродит в broadcast.
6. **Раскрытие после game.ended** (S1.4.3, планируется): сырой seed раскрывается только в match metadata (PostgreSQL или сайдкар-файл), не в event log (ADR-0009 Fork 3). Остальные события остаются скрывающей тайну.

Утечка-вектор для code review: если видишь `seed` где-нибудь кроме (а) private поля комнаты, (б) параметра validate, (в) post-game metadata write — это нарушение.

## Ссылка

Fix-plan A1 (commit 49fcbb5): `seed` → 4-й параметр `validate`, никогда не в GameState.
ADR-0009 Fork 3: seed в приватном поле комнаты, раскрытие в metadata (S1.4.3, pending ratification).
