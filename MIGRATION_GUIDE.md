# Iron District Defense — Game Design Document

## 1. Summary
A top-down city-defense strategy game where you grow an industrial economy by day and survive nightly raids by organized protest factions that pathfind (A*) toward City Hall, damaging buildings/units and stealing “tech” by destroying key industry; you win by surviving a set number of nights or reaching a late-game efficiency milestone, and lose if City Hall is destroyed.

> **Tone Note (implementation-agnostic)**: This GDD frames the defenders as a **fictional authoritarian “Public Security Bureau (PSB)”** rather than a real-world organization. Mechanics remain identical.

---

## 2. Technical Requirements
- **Rendering:** Canvas 2D (built-in, no external libraries required)
- **Single HTML file** with inline CSS + JS
- **Unit system:** pixels  
  - World is a **grid** of tiles; **1 tile = 32×32 px**
- **Pathfinding:** Enemies use **A\*** on the tile grid (4-directional movement only) toward City Hall, re-pathing when blocked
- **Data-driven spawns:** Night enemy waves are defined by **component-style configuration objects** (see §7.5)

---

## 3. Canvas & Viewport
- **Base resolution:** 1280×720
- **Camera:** top-down, **screen-centered on City Hall** by default; can pan
- **Aspect behavior:** responsive scale-to-fit with **letterboxing** (maintain aspect ratio)
- **Background:** dark asphalt + faint grid lines (10% opacity); at night add vignette + subtle scanline overlay

---

## 4. Visual Style & Art Direction
- **Art style:** clean “UI-forward” tactical sim; simple readable shapes with strong silhouettes; high-contrast night readability
- **Mood:** clinical control vs. chaotic crowds; neon warning accents; surveillance motifs (scan rings, CCTV icons)

### Color Palette (hex, purposeful)
- Background asphalt: **#0E1116**
- Tile grid line: **#2A3340**
- City Hall (core): **#D8E2F0**
- Industry (economic buildings): **#4BB3FD**
- Housing/people production: **#7BE495**
- Research/tech: **#B983FF**
- Money/credits: **#FFD166**
- Police units: **#2EC4B6**
- Heavy armor: **#6C757D**
- Enemies (crowds): **#FF595E**
- Elite enemies: **#FF9F1C**
- Warning/damage: **#F72585**
- Night fog/vignette: **#000814**

### Readability rules
- Every building shows a **top-left icon** (type) and **small health bar**.
- Units have **team-colored ring** (player teal, enemy red).
- Path targets: enemies briefly draw a **thin red path preview** (0.2s) whenever they re-path.

---

## 5. Player Specifications (Player Role = City/PSB Commander)
- **Player presence:** cursor-driven commander; no “avatar”
- **Starting position:** City Hall placed at map center
- **Primary interaction:** build/upgrade/place units + defenses during day, tactical abilities during night
- **Movement constraints:** N/A (commander), but **all moving agents are grid-based and 4-directional** for symmetry with A* and barricade gameplay

---

## 6. Physics & Movement (Grid-Time Specs)
**Coordinate convention:** +X right, +Y down (Canvas default)

| Property | Value | Unit |
|---|---:|---|
| Tile size | 32 | px |
| Map size (default) | 40×22 | tiles |
| Unit move speed (light) | 96 | px/sec |
| Unit move speed (heavy) | 64 | px/sec |
| Enemy move speed (crowd) | 80 | px/sec |
| Enemy move speed (vehicle) | 112 | px/sec |
| Projectile speed (bullets) | 520 | px/sec |
| Drone/FPV speed | 220 | px/sec |
| Night duration (base) | 90 | sec |
| Day duration (base) | 75 | sec |

**Time control:**
- Day ↔ Night transition is **player-triggered by holding Space** (see §10), but has minimum locks:
  - Minimum day time before switching: **10 sec**
  - Minimum night time before switching: **20 sec**
- If player never switches, the game auto-switches at the base duration.

---

## 7. Obstacles / Enemies

## 7.1 Enemy Factions (Tiered)
Enemies always spawn at **map edges** (designated “entry tiles”) and advance via A* toward **City Hall** as the ultimate objective. If blocked, they attack blockers/buildings.

### Tier 1 — Crowds
- **Appearance:** clustered red circles with signs
- **HP:** 60
- **DPS vs buildings:** 8 damage/sec (melee)
- **Behavior:** prefers shortest path; attacks barricades if blocking

### Tier 2 — Spies
- **Appearance:** smaller, darker red with hood icon
- **HP:** 45
- **Speed:** +25% vs crowds
- **Special:** prioritizes **industry targets** (factories/offices, labs) within 12 tiles before City Hall
- **Tech theft mechanic:** on destroying an industry building, triggers **Tech Loss** (see §9.4)

### Tier 3 — Veterans
- **Appearance:** orange-red with shield icon
- **HP:** 140
- **Damage reduction:** 25% vs bullets
- **Behavior:** “frontliners” that push into defenses; will target units first if engaged

### Tier 4 — EVs (Electric Vehicles)
- **Appearance:** orange vehicle rectangle with battery icon
- **HP:** 220
- **Speed:** fast; rams barricades
- **Special:** on impact with a barricade/barbed wire, deals burst damage but takes recoil damage

### Tier 5 — Tractors (Heavy)
- **Appearance:** large industrial vehicle silhouette
- **HP:** 520
- **Special:** **structure shred** (bonus damage to barbed wire/barricades), slow but relentless

## 7.2 Enemy Spawn & Scaling
Enemies scale with “Player Power,” computed as:
- **Total building tier score** + **active unit count** + **night survived**

Scaling intent:
- If the player snowballs economy, enemy composition shifts to more spies/vehicles rather than just more crowds.

**Quantitative scaling knobs**
- Base spawn rate: **6 enemies / 10 sec**
- Spawn rate increases by: **+1 enemy / 10 sec** per **Night survived**
- Elite injection: every time Player Power crosses **100 / 200 / 350 / 500**, add:
  - +1 spy component, then +1 veteran, then +1 EV, then +1 tractor per night

## 7.3 Enemy Despawn Conditions
- Enemies despawn only on:
  - **Death**, or
  - Reaching and destroying City Hall (triggers Game Over)

## 7.4 Structures (Player-placed Obstacles)
All structures are grid-placed, occupy tiles, and affect A*.

### Barbed Wire
- Size: 1×1 tile
- HP: 90
- Effect: slows enemies crossing that tile by **35%**
- Cost: 20 money + 2 goods
- Purpose: shaping paths, buying time

### Barricade
- Size: 1×2 tiles (rotatable)
- HP: 260
- Blocks movement fully until destroyed
- Cost: 45 money + 6 goods
- Purpose: hard choke points; forces enemy attacks and reroutes

---

## 7.5 Component-Defined Night Spawns (Data Contract)
Night spawns are described as a list of **components**; each component spawns enemies with rules. (This is a design contract; implementation can store as JS objects.)

**Component fields (required):**
- `type`: `"crowd" | "spy" | "veteran" | "ev" | "tractor"`
- `count`: integer
- `intervalSec`: float (time between spawns)
- `entry`: `"N" | "S" | "E" | "W" | "randomEdge" | "twoOpposite"`
- `delaySec`: float (start delay from night start)
- `ai`: `"toCityHall" | "preferIndustry" | "unitHunter"`
- `mutators`: array of `"armored" | "fast" | "stubborn"` (optional; modifies stats ±15–25%)

**Example night definition (design example):**
- Component A: 18 crowds, 0.6s interval, randomEdge, delay 0, ai toCityHall
- Component B: 5 spies, 2.2s interval, twoOpposite, delay 12, ai preferIndustry
- Component C: 2 veterans, 4.0s interval, E, delay 25, ai unitHunter

---

## 8. World & Environment

## 8.1 Map Layout (Default)
- City Hall at center (tile 20,11 on 40×22)
- A ring road around core (visual only) to guide chokepoints
- 4–8 pre-placed “streets” that are faster to traverse:
  - “Street tiles” reduce movement cost by **15%** for all agents (player units and enemies), encouraging street control

## 8.2 Day/Night Lighting
- **Day:** brighter palette, minimal vignette
- **Night:** darker, stronger contrast, building windows glow; enemy rings brighter

## 8.3 Ambient Motion (Idle Life)
- CCTV scan cones sweep slowly from certain buildings
- Factory chimneys emit looping smoke puffs (simple circles)
- UI warning stripes subtly animate during night

---

## 9. Collision & Scoring

## 9.1 Collision Model
- Grid occupancy for pathing and melee contact
- Combat range checks use **circle distance** in pixels for smoother targeting:
  - Unit engagement radius varies by unit type (see §5 / §12)
- **Forgiving hitboxes:** projectiles use a **-3 px radius shrink** on enemy collision to reduce “unfair clips”

## 9.2 What Triggers Game Over
- City Hall HP reaches 0

## 9.3 Score
Score is “Stability Points (SP)”:
- +1 SP per enemy defeated
- +10 SP per night survived
- +25 SP for preventing any industry damage during a night (“Protected Supply Chain” bonus)

High score:
- Stored in `localStorage` key: **`ironDistrict_bestSP`**

## 9.4 Tech Theft / Tech Loss (Core Risk)
If an enemy destroys an **industry** building (Factories/Offices, Advanced Factory, Lab, AGI Lab, Dark Factory):
- Immediate penalty: **lose 15% of current Research** (rounded down)
- Also lose one random **stored item** if present, priority order:
  1) GPUs, 2) Blueprints, 3) Goods
- Visual + UX: “DATA BREACH” banner + red scanline sweep across screen (see §12.8)

---

## 10. Controls

| Input | Action | Condition |
|---|---|---|
| Left Click | Select building/unit | Any time |
| Left Click (on empty tile) | Place selected build/structure | During Day only |
| Right Click (drag) | Pan camera | Any time |
| Mouse Wheel | Zoom in/out (0.8× to 1.4×) | Any time |
| 1–9 | Hotbar select building/unit/structure | Any time |
| R | Rotate placeable (for barricade) | During placement |
| Space (hold 0.6s) | Toggle Day ↔ Night (transition) | Respects min lock timers |
| P or Escape | Pause/unpause | Any time |
| Q / W / E | Activate abilities: CCTV Hack / EM Interference / Chemical Gas | Night only (if unlocked + energy available) |

**Mobile/touch (required if implementing touch):**
- Tap to select/place
- Two-finger drag to pan, pinch to zoom
- On-screen buttons for Space toggle + abilities + pause

---

## 11. Game States

## 11.1 Menu
- Title, short premise, **controls always visible**
- Buttons: Start, How to Play, Credits (minimal)
- Shows best SP from localStorage

## 11.2 Playing — Day
- Building placement & upgrades enabled
- Industry produces resources continuously
- Threat forecast panel shows:
  - “Expected Night Composition” (approximate) based on scaling
- UI shown: Money, Goods, Blueprints, GPUs, Staff, Research; hotbar; “Hold Space to start Night”

## 11.3 Playing — Night
- Building placement disabled (except abilities)
- Units auto-engage
- UI shown: all resources + **Night timer** + ability cooldown/energy + “Hold Space to call Day” (if minimum time met)

## 11.4 Paused
- Freeze everything including timers
- Overlay with controls legend and “Resume / Restart / Menu”

## 11.5 Game Over
- Trigger: City Hall destroyed
- Shows: final SP, best SP, nights survived, “Tech stolen” count
- Buttons: Retry (same seed), New Run (new seed), Menu

---

## 12. Game Feel & Juice (REQUIRED)

## 12.1 Input Response (Same-frame acknowledgment)
- **Place building preview:** ghost tile highlights appear immediately when hotbar item selected
- **Denied placement (blocked tile / night time):**
  - Tile flashes **#F72585** for **120 ms**
  - Quick “thud” screen nudge (2 px) even without audio
- **Hold Space to transition:** circular progress ring fills around the Day/Night button; releasing early snaps back with elastic easing

## 12.2 Animation Timing (Exact)
- **Selection pop:** selected entity scales 1.00 → 1.08 over **90 ms**, ease-out
- **Placement confirm:** building drops from +8 px to 0 over **120 ms**, ease-out
- **Resource gain tick:** number briefly rises +6 px and fades **180 ms**
- **Damage flash:** hit entity tints toward warning color for **70 ms**, then returns over **140 ms**

## 12.3 Near-Miss Rewards
Near-miss definition (night only):
- An enemy comes within **2 tiles** of an industry building but is killed before dealing damage.

Reward:
- +5 SP, floating text “CLOSE CALL +5”
- Brief **time dilation 0.85× for 0.35 sec**
- Thin teal shock ring expands from the saved building

## 12.4 Screen Effects
| Effect | Trigger | Feel |
|---|---|---|
| Shake | City Hall hit / large explosion | 6 px amplitude, 180 ms, fast decay |
| Flash | Milestone / tech breach | Full-screen overlay 10–18% opacity, 120 ms |
| Zoom pulse | Night start, Night end | 1.00 → 1.06 → 1.00 over 420 ms |
| Time dilation | Near-miss / City Hall at <15% HP | 0.85× (near-miss 0.35s), 0.75× (critical 0.6s) |

## 12.5 Progressive Intensity (Escalation)
At SP thresholds:
- **50 SP:** night vignette stronger; spawn rate +10%
- **150 SP:** add more spies; UI warnings more frequent
- **300 SP:** vehicles appear reliably; streets become strategic (more enemies choose streets)
- **500 SP:** tractors appear; “Data breach” penalty increases from 15% to **20% research**

## 12.6 Idle Life
- City Hall emits a slow “pulse ring” every **2.5 sec**
- Factories show conveyor-like moving stripes
- During day, small worker dots travel between residences and workplaces (cosmetic only)

## 12.7 Milestone Celebrations
- Every **100 SP:** “STABILITY UP” banner, teal flash, +10 money bonus
- New best SP: gold banner + persistent small crown icon next to SP counter for the rest of the run

## 12.8 Death Sequence (Impactful)
When City Hall reaches 0 HP:
1) **Freeze frame** 0.25 sec + desaturate to 35%
2) Heavy shake 0.35 sec
3) City Hall collapses: scale down to 0.85 with crack overlay 0.5 sec
4) Fade to Game Over screen over 0.7 sec

---

## 13. UX Requirements
- Controls shown on **menu and in-game HUD** (always accessible legend button)
- Day/Night status is unmistakable: big label + color theme + timer
- **Build mode** shows:
  - footprint highlight (green valid / red invalid)
  - projected resource delta (per day)
- **Fairness & clarity**
  - enemies show target icon when switching targets
  - industry buildings have distinct icon and “risk outline” at night
- Touch support recommended; if included, must have visible buttons for: Toggle Day/Night, Pause, Abilities

---

## Economy, Buildings, Units (Core Systems)

### Resources (all shown in HUD)
- **Money:** used for most construction/upgrades
- **Goods:** basic production material (barriers, units)
- **Blueprints:** unlock/upgrade advanced tech buildings/units
- **GPUs:** late-game compute resource (AGI Lab, advanced drones)
- **Staff:** required to operate labs/offices; created by residences + re-education pipeline
- **Research:** unlocks abilities/late-game upgrades

### Building Grid Rules
- Most buildings: **2×2 tiles**
- Roads/streets are non-buildable (optional design), or buildable with penalty (pick one in implementation; default: **non-buildable**)

## Buildings (sizes, roles, outputs)
All buildings have HP and can be attacked at night.

**City Hall (Core)**
- Size: 3×3 tiles
- HP: 2000
- Passive: +10 money/day baseline

**Residence**
- Size: 2×2
- HP: 420
- Output (day): +1 Staff per 6 sec (cap storage)
- Note: staff represents “available workforce/admin”

**Farm**
- Size: 2×2
- HP: 380
- Output (day): +2 Goods per 5 sec

**Sweatshop**
- Size: 2×2
- HP: 320
- Output (day): converts 1 Staff → +4 Goods every 8 sec
- Risk: if destroyed, drops “loot” to enemies increasing next night spawn by +5% (represents propaganda win)

**Re-education Camp**
- Size: 2×2
- HP: 500
- Function: converts “Prisoners” (gained from night captures; see below) into Staff
- Output: 1 Prisoner → 1 Staff per 7 sec
- Night effect: nearby defeated enemies have a **15% chance** to become Prisoners instead of disappearing (within 6 tiles)

**Factory / Office**
- Size: 2×2
- HP: 520
- Output (day): +12 money per 10 sec and +1 Blueprint per 18 sec (requires 1 Staff active)
- If no Staff: operates at 40% speed

**Advanced Factory**
- Size: 3×2
- HP: 700
- Output (day): +1 GPU per 30 sec (requires 2 Staff) and +1 Blueprint per 12 sec

**Lab**
- Size: 2×2
- HP: 460
- Output (day): +1 Research per 2 sec (requires 2 Staff)
- Unlocks abilities tiers

**Late-game Efficiency Upgrades**
- **Dark Factory** (3×3, HP 900): doubles Goods output of connected Farms/Sweatshops within 8 tiles, but increases night spawn rate +8% (heat)
- **AGI Lab** (3×3, HP 800): converts GPUs into Research at high efficiency: 1 GPU → +40 Research over 20 sec; also unlocks strongest ability upgrades

---

## Units (auto-engage; spawned from buildings)
Units cost Money + Goods and may require Blueprints/GPUs.

**Humanoid Police**
- Spawn source: City Hall / Barracks upgrade (City Hall tier)
- HP: 120
- Range: 120 px
- DPS: 18
- Role: generalist, holds lines

**Robots (Suppression Droids)**
- Spawn source: Factory/Office (upgrade path)
- HP: 180
- Range: 140 px
- DPS: 14 (but +40% vs crowds)
- Role: anti-crowd efficiency

**FPV Swarms (Drone Burst)**
- Spawn source: Advanced Factory / Drone Bay upgrade
- HP: 40 (fragile)
- Speed: 220 px/sec
- Attack: dive-bomb single target for burst 70 damage then must “rearm” 6 sec
- Role: pick off spies/veterans; high skill via ability synergy

**Tanks**
- Spawn source: Advanced Factory (late unlock)
- HP: 520
- Range: 200 px
- DPS: 28 splash (small radius 26 px)
- Role: anti-vehicle/tractor; expensive anchor

**Auto-engage rules (clarity-first)**
- Default target priority:
  1) enemies attacking City Hall, then
  2) enemies within 3 tiles of any industry, then
  3) nearest enemy
- Units do not chase beyond **10 tiles from City Hall** (prevents map-wide kiting)

---

## Abilities (Night-only)
All abilities consume **Authority Energy (AE)**:
- AE max: 100
- AE regen: 8/sec at night, 12/sec day (encourages planning)
- Denied cast: button flashes and shows “NO AE” for 0.4s

**Q — CCTV Hacking**
- Cost: 35 AE, cooldown 10 sec
- Effect: reveal enemy paths + apply “Marked” debuff in a 6-tile radius for 6 sec
- Marked: units deal +20% damage to marked enemies

**W — EM Interference**
- Cost: 50 AE, cooldown 16 sec
- Effect: disables EV special and reduces drone/veteran speed by 30% in a 7-tile radius for 5 sec

**E — Chemical Gas**
- Cost: 60 AE, cooldown 22 sec
- Effect: lingering cloud (5-tile radius) for 7 sec; crowds take 10 DPS and deal -25% damage while inside
- Veterans/tractors take half damage (resistance)

---

## 14. Out of Scope (V1)
- Soundtrack/voice acting
- Online features, leaderboards, cloud saves
- Complex citizen simulation or traffic sim
- Fully deformable terrain / physics destruction
- Detailed morality/narrative branching system
- Multiplayer/co-op
- Modding tools / in-game map editor

---

## 15. Success Criteria
- [ ] Runs from a **single HTML file** with no console errors
- [ ] **Controls visible** on menu and during gameplay
- [ ] Day/Night transitions triggered by **holding Space**, with clear feedback ring
- [ ] Enemies use **A\*** on a tile grid and re-path around new barricades
- [ ] Industry produces **money + materials** in daytime; player can invest/upgrade
- [ ] Night enemies **scale with player power** (not purely time)
- [ ] Tech theft/tech loss triggers when industry is destroyed, with clear feedback
- [ ] Units auto-engage with readable targeting priorities; enemies can attack units/buildings symmetrically
- [ ] Near-miss system triggers and rewards with time dilation + UI pop
- [ ] Pause works; timers and combat freeze
- [ ] Game Over sequence is impactful and readable; best score persists in localStorage
- [ ] “Feels alive” idle animation present in both day and night

---

If you want this to be *more RTS* (manual unit commands) or *more tower defense* (no movable units), say which direction—right now the spec is a hybrid with **auto-engage units + tactical abilities** and heavy emphasis on **economy-to-defense conversion**.