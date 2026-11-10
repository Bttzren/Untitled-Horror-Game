# Co-op Dream Horror — Design Spec

Date: 2026-11-10
Status: awaiting review
Working title: Untitled Horror Game

## 1. Purpose

A scary-but-fun co-op game to play with a friend group, with a possible
public release on itch.io later. The feel is tension and chaos shared with
friends ("scream, then laugh"), not gore or pure dread.

Co-op extraction horror games are the genre inspiration only. The setting,
entities, names, art and audio are original.

### Success criteria

- Two to four friends can join one room with a code and finish a night
  together in a desktop browser.
- One player can play alone (hosting with nobody else in the room).
- A night produces real choices between greed and safety.
- The build is a folder of static files that runs when uploaded to itch.io.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Players | 1–4 co-op |
| Core loop | Loot and extract against a quota |
| Setting | Liminal dream spaces inside a stranger's nightmare |
| Threat | No weapons: run, hide, and learn each entity's rule |
| Platform | Desktop web browser, 3D |
| Multiplayer | One player hosts in their browser; others connect directly with a room code |
| Art and audio (v1) | Generated in code; no imported models or sound files |

## 3. Gameplay

### 3.1 Premise

Players are retrievers who enter a stranger's nightmare to pull out their
memories. Each night has a quota of memory value to bring back.

### 3.2 Run structure

A run is a sequence of nights, starting at night 1. Each night:

1. **Lobby.** The host creates a room and shares a 5-character code.
   Players gather in the waking room. The host starts the night.
2. **Enter.** Everyone spawns at the Door inside a freshly generated dream.
3. **Retrieve.** Players find memories, carry them to the Door and bank them.
4. **Destabilise.** A timer counts down. At the halfway point the dream
   enters phase 2: lights flicker and fail, and another entity wakes.
5. **Leave.** Once banked value reaches the quota, the Door opens. A player
   leaves by interacting with the open Door, then spectates.
6. **Night ends** when every uncaught player has left, when all players are
   caught, or when the timer reaches zero. At zero the dream collapses and
   anyone still inside is caught.

**Night succeeds** if the quota is met and at least one player left through
the Door. Everyone, including caught players, goes on to the next night.

**Night fails** if the quota is unmet at collapse, or every player is caught
before anyone leaves. The run ends and the next run starts at night 1.

### 3.3 Numbers (starting values, all tunable in one config file)

| Value | Setting |
|---|---|
| Night length | 8 minutes |
| Phase 2 begins | 4 minutes remaining |
| Quota | 150 on night 1, +100 each night |
| Total memory value placed | 1.6 × quota |
| Rooms | 8 on night 1, +2 each night, maximum 20 |
| Walk / sprint / crouch speed | 3.0 / 5.5 / 1.5 m/s |
| Stamina | 5 s of sprint, refills in 10 s when not sprinting |

### 3.4 Memories (loot)

Each memory has a value, a weight class and optionally a constant noise.

| Class | Value | Carry speed | Can sprint | Example |
|---|---|---|---|---|
| Light | 10–25 | 100% | Yes | Child's drawing, photograph |
| Medium | 30–60 | 85% | Yes | Music box, rotary phone |
| Heavy | 70–120 | 65% | No | Grandfather clock face, television |

- A player carries one memory at a time.
- Some memories are noisy (a ringing phone, a playing music box) and emit
  noise continuously while carried or lying in the open.
- A carried memory can be dropped or thrown. Both make noise where it lands.
- Banking is done by interacting with the Door while carrying a memory.
  Banked value is shared by the team and cannot be lost.

### 3.5 Player actions

| Action | Key | Notes |
|---|---|---|
| Move | WASD | |
| Look | Mouse | Pointer lock |
| Sprint | Shift | Loud, uses stamina |
| Crouch | Ctrl or C | Slow, silent |
| Interact | E | Pick up, bank, hide, leave hiding spot, leave through Door |
| Drop | Q | |
| Throw | Left click | Only while carrying |
| Flashlight | F | No battery in v1 |

### 3.6 Noise

Actions create noise events at a position with a radius. Entities that
hear react to events whose radius reaches them (straight-line distance).

| Source | Radius |
|---|---|
| Crouch-walking | 1 m |
| Walking | 4 m |
| Sprinting | 12 m |
| Noisy memory (continuous) | 10 m |
| Dropped light or medium memory | 8 m |
| Dropped heavy memory, any thrown memory landing | 14 m |

### 3.7 Hiding

Dreams contain hiding spots (lockers, curtains). A hidden player cannot
move or carry a memory; a carried memory is dropped silently on entering.
An entity cannot detect a hidden player unless it had line of sight to
that player at the moment they hid.

### 3.8 Getting caught

A caught player drops what they carry, is out for the rest of the night
and spectates remaining players. They return at the start of the next night.

### 3.9 Entities

Every entity follows one rule that players can learn. Entities are built
on a shared interface (section 4.3) so more can be added without changing
the rest of the game. Version 1 ships two.

**The Usher** — moves only when unobserved.

- It is observed when any uncaught, unhidden player has it within 50° of
  their view direction, within 30 m, with clear line of sight.
- Observed: it is completely frozen.
- Unobserved: it moves toward the nearest uncaught, detectable player at
  6 m/s, faster than a sprint.
- It catches a player at 1.0 m while unobserved.

**The Listener** — blind, hunts sound.

- It wanders between rooms at 2 m/s.
- On hearing noise it moves to the loudest recent noise position at
  4.5 m/s: faster than walking, slower than sprinting, and sprinting is loud.
- On arrival it searches for 5 s, then resumes wandering.
- It catches any unhidden player within 1.2 m, silent or not.
- It never reacts to sight or light.

**Spawning.** Nights 1–2: one entity (chosen from the seed) is active at
the start and the other wakes at phase 2. Night 3 onward: both are active
from the start. Entities spawn at least three rooms away from the Door.

## 4. Architecture

### 4.1 Stack

- TypeScript (strict), built with Vite into static files
- Three.js for rendering
- PeerJS (WebRTC data channels) for browser-to-browser connections
- Web Audio API for sound
- Vitest for unit and integration tests, Playwright for a browser smoke test

No physics engine: movement and collision use the dream's grid.

### 4.2 Parts

Each part has one job and a narrow interface. Dependencies point one way:
View and Connection depend on Rules; Rules depends on nothing but Dream data.

```
src/
  rules/        Game rules. No rendering, no networking, no browser APIs.
    world.ts      World state and the fixed-step update
    player.ts     Movement, stamina, carrying, hiding
    items.ts      Memories: pick up, drop, throw, bank
    round.ts      Quota, timer, phases, night success and failure
    noise.ts      Noise events
    nav.ts        Grid pathfinding and line of sight
    config.ts     All tunable numbers
    entities/
      index.ts    Entity interface and registry
      usher.ts
      listener.ts
  dream/        Seed -> map. Pure functions.
    rng.ts        Seeded random numbers
    rooms.ts      Room templates
    generator.ts  Layout, memory spawns, hiding spots, the Door
  net/          Moving messages between browsers.
    protocol.ts   Message types
    transport.ts  Transport interface
    peerTransport.ts      PeerJS implementation
    loopbackTransport.ts  In-memory implementation for solo play and tests
    host.ts       Runs Rules, accepts inputs, sends snapshots
    client.ts     Sends inputs, receives snapshots, predicts and interpolates
  view/         What the player sees and hears.
    renderer.ts   Three.js scene built from dream and world state
    audio.ts      Positional and ambient sound, synthesised
    ui/           Menu, lobby, HUD, spectator view, messages
  input/        Keyboard and mouse -> input commands
  main.ts       Wires the parts together
```

### 4.3 Rules

- Advances in fixed steps of 1/30 s. Given the same starting state and the
  same inputs it produces the same result, which makes it testable.
- Runs in full only on the host. Clients reuse `player.ts` movement to
  predict their own motion.
- **Entity interface.** Each entity type registers an object with a `spawn`
  function and an `update(entity, world, dt)` function. `update` may read
  the world and use shared helpers (pathfinding, line of sight, recent
  noise events, catching a player). Adding an entity means adding one file
  and one registry entry, plus a rendering and sound entry in View.

### 4.4 Dream generator

- Input: seed, night number. Output: a grid map (4 m cells) of rooms and
  doorways, the Door position, memory spawns, hiding spots, entity spawns,
  and light positions.
- Starts with the Door room and grows by attaching room templates at open
  doorways, so every room is reachable by construction.
- Version 1 room templates: long hallway, corner hallway, empty pool,
  office floor, stairwell landing, waiting room.
- The host picks the seed and sends it; every client generates the same map.

### 4.5 Connection

- **Room codes.** 5 characters from an alphabet without look-alikes
  (no 0/O, 1/I). The host's PeerJS id is a fixed prefix plus the code.
  The public PeerJS signalling server is the default and is configurable.
- **Authority.** The host is the only source of truth.
- **Messages** (JSON in v1):

| Message | Direction | Content |
|---|---|---|
| `hello` | client → host | Display name |
| `welcome` | host → client | Assigned player id, lobby state |
| `lobby` | host → all | Player list |
| `start` | host → all | Seed, night number, quota |
| `input` | client → host | Sequence number, movement, look angles, action flags |
| `snapshot` | host → all | Tick, last processed input per player, players, entities, changed memories, banked value, time left, phase |
| `event` | host → all | One-off happenings: caught, banked, noise (for sound cues) |
| `end` | host → all | Night result and next-night info |

- Inputs are sent every simulation step; snapshots 15 times per second.
- **Prediction.** A client moves its own player immediately, then replays
  unacknowledged inputs on top of each snapshot. Other players and
  entities are drawn about 100 ms in the past, blended between snapshots.
- **Limits.** The host refuses a fifth player. Joining during a night is
  refused with "night in progress"; the room is open again in the lobby.
- **Solo.** The host runs with the loopback transport and no peers.

### 4.6 View

- Geometry, materials and textures are generated in code from the dream
  map. The liminal look comes from repetition, flat lighting, fog,
  flickering fixtures and each player's flashlight.
- Audio is synthesised with Web Audio: ambient hum, footsteps, memory
  noises, entity cues, positioned in 3D.
- Imported models and sound files can replace generated ones later
  without changing Rules or Connection.

### 4.7 Privacy

No accounts and no stored data. Players choose a display name each
session. The signalling server sees room codes and connection details
only, as required to connect browsers.

## 5. Failure handling

| Situation | Behaviour |
|---|---|
| Host disconnects | Clients show "The host left — the dream ended" and return to the menu |
| Client disconnects | Their player is removed; a carried memory drops in place; the night continues |
| Wrong room code | "No room with that code" |
| Room full or night in progress | A message saying which |
| Direct connection blocked by the network | "Couldn't connect — this network may block direct connections" after a 15 s timeout |
| Signalling server unreachable | "Couldn't reach the matchmaking server" with a retry button |
| Tab loses focus or pointer lock | The player stops moving; the game continues for others |

## 6. Testing

- **Rules (unit).** Movement speeds and stamina; carry speed by weight;
  banking and quota; night success and failure conditions; noise radii;
  hiding and the line-of-sight exception; the Usher freezes when observed
  and moves when not; the Listener goes to the loudest noise and ignores
  silent crouching players out of reach.
- **Dream generator (unit).** Same seed gives the same map; every room and
  every memory is reachable from the Door; placed value is at least
  1.6 × quota; room count matches the night.
- **Connection (integration).** A host and three clients over the loopback
  transport: join, start, play scripted inputs, and agree on the result;
  fifth join refused; client drop handled; host drop reported.
- **Browser smoke test (Playwright).** Two pages host and join a room
  against a local signalling server, start a night, and both render.

## 7. Build order

Each step ends with something that runs.

1. Walk around a generated dream, solo
2. Friends can join a room and see each other move
3. Memories, the Door, quota, timer and night results
4. The Usher and the Listener, hiding, getting caught
5. Lobby, HUD, spectating, sound
6. Shareable static build, itch.io packaging

## 8. Not in version 1

- More entities (planned next; an entity that imitates a teammate is the
  leading candidate)
- Rescuing caught players
- Built-in or proximity voice chat
- Shops, upgrades or progression between nights
- Imported 3D models, textures and recorded audio
- Mobile and gamepad controls
- Joining mid-night, host migration, dedicated servers
- Accounts, saved progress, leaderboards
