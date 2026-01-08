# Iron District Defense — MVP Game Design Document

## 1. Summary
A top-down tactical defense game where you **survive 3 nights** of swarming crowd attacks by commanding police units and **driving a Robot Tire to ram through enemies**. Build economy during day, make fast tactical decisions during night. Economics is easy—executing risky maneuvers without getting overwhelmed is not.

**Core Loop:** Build during day → Defend during night → Survive 3 nights to win
**Core Reward:** Good economic decisions → Upgrade Robot Tire → Massive satisfying crowd damage

---

## 2. Technical Requirements
- **Engine:** Kite3D (built on threepipe and three.js)
- **Rendering:** 3D with top-down camera view (orthographic camera)
- **Architecture:** Component-based using `Object3DComponent` classes
- **Code organization:**
  - `.script.js` files for game components
  - ES6 modules (`import`/`export`)
  - Scene designed in Kite Editor, exported as `.scene.glb`
- **Unit system:** three.js world units (1 unit = 1 meter)
- **Pathfinding:** Enemies move directly toward targets (simple steering), re-path when blocked
- **Pattern:** Manager/System pattern for entities (EnemySystemComponent, UnitSystemComponent, etc.)

---

## 3. Camera & Viewport
- **Camera type:** OrthographicCamera (top-down view)
- **Camera position:** Centered on City Hall by default; player can pan
- **Zoom:** Adjusts orthographic size (mouse wheel)
- **Background:**
  - Ground plane mesh with dark asphalt material (#0E1116)
  - At night: add vignette effect

---

## 4. Visual Style & Art Direction
- **Art style:** Low-poly 3D tactical sim; simple geometric shapes
- **Mood:** **Chaotic, intense, overwhelming** - player should feel genuinely overwhelmed by adaptive crowds
- **Gore priority:** Dismemberment, ragdoll physics, blood splatter, realistic agony motions
- **3D Assets:**
  - Buildings: simple box geometries with distinct materials/colors
  - Units: cylinder or capsule shapes with team-colored emissive rings
  - Enemies (crowds): simple shapes, color-coded red
  - Use MeshStandardMaterial for all objects

### Color Palette
- Background asphalt: **#0E1116**
- City Hall (core): **#D8E2F0**
- Money generator: **#FFD166**
- Police units: **#2EC4B6**
- Robot Tire: **#6C757D** (heavy armor gray)
- Enemies (crowds): **#FF595E**
- Warning/damage: **#F72585**
- Blood: **#8B0000** (dark red)

### Readability
- Health bars visible by default on ALL units and enemies (HTML overlay)
- Units have **emissive team-colored ring** at base (player teal #2EC4B6, enemy red #FF595E)
- Minimap shows units, enemies, terrain, buildings (Starcraft-style)

---

## 5. Player Specifications

### During Day
- **Cursor-driven commander** (no avatar)
- Click to select buildings/units
- Click to place buildings (money cost)
- Repair/recharge Robot Tire (cost scales with player balance)

### During Night (Combat)
- **Robot Tire control:** Click and hold on Robot Tire, it accelerates toward mouse position
- **Unit commands:**
  - Select units (click or drag-select)
  - Right-click to give orders:
    - **Move + Auto-attack** (default): units path to location using A\*, auto-engage enemies in range
    - **Move + Hold** (Shift+right-click): units path to location, only attack within radius of hold position
  - Most time spent on tactical unit selection (composition) and positioning decisions

### Input Handling
- Use window keyboard events in component `start()`/`stop()` lifecycle
- Mouse position converted to 3D world via Raycaster against ground plane

---

## 6. Physics & Movement

**Coordinate convention:** three.js default (+X right, +Y up, +Z toward camera in top-down view)
- Use XZ plane for movement (Y=0 or small height offset)

| Property | Value | Unit |
|---|---:|---|
| Map size (default) | 40×22 | world units |
| Police move speed | 3.0 | units/sec |
| FPV move speed | 6.9 | units/sec |
| Robot Tire max speed | 8.0 | units/sec |
| Robot Tire acceleration | 12.0 | units/sec² |
| Enemy move speed (crowd) | 2.5 | units/sec |
| Day minimum duration | 3 | sec |
| Night duration | Variable | ends when all enemies defeated |

**Time control:**
- Day ↔ Night transition: **player-triggered by holding Space** (5s hold)
  - Minimum day time before switching: **3 sec**
  - Night ends automatically when all spawned enemies are defeated

**Implementation:**
- GameManagerComponent tracks elapsed day time in `update({deltaTime})`
- EnemySystemComponent tracks active enemy count + queued spawn count
- When night is active and (activeEnemies + queuedEnemies) reaches 0, trigger day transition automatically

---

## 7. Enemies

### Crowds (Only enemy type for MVP)
- **Mesh:** Cylinder (radius 0.4, height 0.6) with red material (#FF595E)
- **HP:** 60
- **DPS vs buildings:** 8 damage/sec (melee)
- **Behavior:** Follows target priority (see below)
- **Gore:** On death, dismember into body parts (separate meshes), apply ragdoll physics, spawn blood splatter decals/particles
- **Agony motion:** When hit but not killed, play hurt animation/reaction

**Target Priority (AI):**
1. Enemies attacking City Hall
2. Enemies within 3 units of any resource generator
3. Nearest enemy to their current position

**Architecture:**
- Each enemy is a three.js Object3D with `EnemyDataComponent` attached
- `EnemySystemComponent` (singleton manager) handles all enemy updates in single `update()` loop
- Use simple geometric primitives for body parts (for dismemberment)

### Enemy Spawn & Scaling
- **Night 1:** 20 crowds
- **Night 2:** 35 crowds
- **Night 3:** 50 crowds
- Spawn at map edges (designated spawn points), configurable in `EnemySystemComponent.nightWaves` StateProperty
- Example: `{type: 'crowd', count: 20, intervalSec: 1.0, entry: 'randomEdge', delaySec: 0, ai: 'toCityHall'}`

---

## 8. Controls

**Input handling architecture:**
- `InputManagerComponent` handles all input via window event listeners
- Mouse position converted to 3D world space via Raycaster against ground plane
- Event listeners added in `start()`, removed in `stop()`

| Input | Action | Implementation |
|---|---|---|
| Left Click | Select unit/building | Raycast to find clicked Object3D |
| Left Click + Drag | Drag-select multiple units | Draw selection box, collect units in box |
| Right Click | Give unit order (move+attack) | Path units to location |
| Shift + Right Click | Give unit hold order (move+hold) | Path units, set hold radius |
| Click Robot Tire + Hold | Tire accelerates toward mouse | Track mouse position, apply acceleration vector |
| Left Click (empty, day) | Place building | Check placement validity, spawn Object3D if affordable |
| Right Click + Drag | Pan camera | Update camera position |
| Mouse Wheel | Zoom in/out (0.8× to 1.4×) | Adjust orthographic camera size |
| Space (hold 0.6s) | Toggle Day ↔ Night | Track hold time, trigger transition |
| P or Escape | Pause/unpause | Set `ctx.ecp.running` flag |

---

## 9. Game States

**State management:**
- `GameManagerComponent` tracks `gameState` as StateProperty: `'menu' | 'day' | 'night' | 'paused' | 'victory' | 'gameover'`
- State changes trigger UI updates via `onStateChange()` callbacks

### 9.1 Menu
- HTML overlay: title, "Start Game", controls legend
- Shows: "Survive 3 nights"

### 9.2 Playing — Day
- **State:** `gameState = 'day'`
- Building placement enabled
- Resource generators produce money continuously
- **UI:**
  - Money counter (top-left)
  - Minimap (bottom-right corner)
  - "Hold Space to start Night" (when 3 sec minimum met)

### 9.3 Playing — Night
- **State:** `gameState = 'night'`
- Building placement disabled
- Units auto-engage based on orders
- Robot Tire player-controlled
- Night ends automatically when all enemies defeated
- **UI:**
  - Minimap

### 9.4 Paused
- **State:** `gameState = 'paused'`
- Set `ctx.ecp.running = false`
- Overlay: "Paused" + controls legend + "Resume"

### 9.5 Victory
- **State:** `gameState = 'victory'`
- **Trigger:** Survived night 3 (all enemies defeated on night 3)
- UI: "Victory! You survived 3 nights" + "Continue to next map" / "Restart"

### 9.6 Game Over
- **State:** `gameState = 'gameover'`
- **Trigger:** City Hall HP reaches 0
- UI: "Game Over" + "Retry" / "Menu"

---

## 10. Combat Feel & Gore (PRIORITY)

**Goal:** Chaotic, intense, overwhelming feeling. Satisfying, gory tire-crowd collisions.

### 10.1 Robot Tire - Crowd Collision Physics
- **High-speed impact detection:** Use sphere-sphere collision between tire and crowd
- **On collision:**
  1. Deal massive damage (150-200, instant kill for crowd HP 60)
  2. Apply impulse to enemy (send flying backward)
  3. Trigger dismemberment
  4. Spawn blood splatter
  5. Play impact sound cue placeholder (visual feedback for now)
  6. Camera shake (amplitude scales with tire speed)
  7. Time dilation (0.85× for 0.2sec) if multiple kills in quick succession

### 10.2 Dismemberment System
- **On crowd death:** Break enemy mesh into 3-5 body part meshes (head, torso, limbs)
- **Physics:** Apply ragdoll-like physics (simple rigid body simulation or tweened motion)
- **Parts fly apart** with velocity based on impact direction and force
- **Cleanup:** Parts fade out and dispose after 3-5 seconds

### 10.3 Blood Splatter
- **Method 1 (simpler):** Spawn red decal planes on ground at death location, fade over time
- **Method 2 (fancier):** Particle system with red sphere particles that fall to ground and stick
- Blood splatters should accumulate during night, clear on day transition

### 10.4 Agony Motions
- **When crowd takes damage but survives:**
  - Briefly play "hurt" animation (tilt/recoil)
  - Flash material red for 70ms
  - Optional: spawn small blood particles

### 10.5 Screen Effects
| Effect | Trigger | Implementation |
|---|---|---|
| Camera Shake | Tire collision / City Hall hit | Offset camera position randomly, decay over 180ms |
| Time Dilation | Multi-kill with tire (3+ in 1 sec) | Scale all deltaTime by 0.85× for 0.2sec |
| Damage Flash | Unit/building takes damage | Tween material emissive toward #F72585 for 70ms |

---

## 11. UI Requirements (Minimal)

### Money Counter
- **Position:** Top-left corner
- **Display:** "💰 $X" (HTML overlay via HtmlUiComponent)
- **Updates:** Real-time as money changes

### Minimap
- **Position:** Bottom-right corner
- **Size:** 200×120 px (proportional to 40×22 map)
- **Style:** Starcraft-style top-down representation
- **Elements:**
  - Ground/terrain: dark blue
  - Buildings: colored gold squares 
  - Player units: blue dots
  - Enemies: red dots
  - Viewport indicator: white rectangle showing camera view
- **Implementation:** Render separate orthographic camera to small render target, display as HTML canvas overlay or texture

### Health Bars
- **Position:** Above each unit/enemy/building
- **Style:** Small horizontal bar (width: 0.8 units, height: 0.1 units)
  - Green → Yellow → Red based on HP percentage 
- **Implementation:** HTML overlay positioned via world-to-screen projection in `preFrame()`
- **Always visible** by default

### Night/Enemy Counter
NONE

---

## 12. Economy & Buildings

### Resources
- **Money only** (no Goods, Blueprints, GPUs, Staff, Research)
- Starting money: $500
- Display in HUD

### Building Types (3 only)

#### City Hall (Core)
- **Mesh:** Large box (3×1×3) with #D8E2F0 material
- **HP:** 1000
- **Passive:** +$10/sec baseline
- **Cannot be sold or destroyed by player**

#### Money Generator
- **Mesh:** Box (2×1×2) with #FFD166 material
- **HP:** 400
- **Output:** +$100/night
- **Cost:** $100
- **Build during day only**

#### Barricade
- **Mesh:** Wall (1×1×2) with #808080 material
- **HP:** 500
- **Passive:** Blocks enemy movement
- **Build during day only**

### Building Placement
- **Free placement:** Buildings placed at mouse position (user manually ensures spacing)
- **Preview:** Ghost mesh at mouse position (green if valid, red if invalid)
- **Day only:** Building placement disabled during night

---

## 13. Units

**Component architecture:**
- Each unit is an Object3D with `UnitDataComponent` attached
- `UnitSystemComponent` manages all unit AI/combat in single `update()` loop
- Unit meshes: simple shapes with team-colored emissive ring at base

### Humanoid Police
- **Mesh:** Cylinder (radius 0.3, height 0.9) with #2EC4B6 emissive ring
- **Spawn:** Manually placed by player during day (like building placement)
- **Cost:** $80
- **HP:** 120
- **Range:** 3.75 world units
- **DPS:** 18
- **Speed:** 3.0 units/sec
- **Role:** Generalist defense, holds positions
- **Commands:**
  - Move + Auto-attack (default): paths to location, engages enemies in range
  - Move + Hold (Shift+right-click): paths to location, only attacks within 2 unit radius

### FPV Drone
- **Mesh:** Small sphere (radius 0.2) with blue emissive glow
- **Spawn:** Manually placed by player during day
- **Cost:** $120
- **HP:** 40 (fragile)
- **Speed:** 6.9 units/sec
- **Attack:** Dive-bomb single target for burst 70 damage, then "rearm" 6 sec (move away, return)
- **Role:** Pick off targets, high mobility
- **Commands:** Same as police (move+attack, move+hold)

### Robot Tire (Special/Ultimate)
- **Mesh:** Torus or cylinder (radius 0.6, height 0.4) with #6C757D material + metallic
- **Spawn:** Automatically available at start of each night (if repaired/charged)
- **Cost:** Requires Tire Repair Center + repair cost (10% of player money, min $50)
- **HP:** 500
- **Speed:** Max 8.0 units/sec
- **Acceleration:** 12.0 units/sec² toward mouse when clicked+held
- **Collision damage:** 150-200 per hit (instant kills crowds)
- **Resistance:** High resistance to damage (75% reduction from crowd attacks, 50% from projectiles)
- **Control:**
  - Click tire to select
  - Hold mouse button: tire accelerates toward mouse position
  - Release: tire decelerates with friction
- **Usage:** Typically used once per night (expensive to repair)
- **Visual:** Leaves tire track decals on ground, blood splatters on impact

### Auto-engage Rules (for Police & FPV with auto-attack orders)
Implemented in `UnitSystemComponent.update()`:
- **Target priority:**
  1. Enemies attacking City Hall
  2. Enemies within 3 units of any Money Generator
  3. Nearest enemy
- **Chase limit:** Units do not chase beyond 10 units from their order position (prevents kiting across map)

---

## 14. Win/Loss Conditions

### Victory
- **Condition:** Survive all 3 nights
- **Check:** After night 3 ends (all enemies defeated), trigger `gameState = 'victory'`
- **Progression:** Player can continue to next map (resets all buildings/units/money) or restart current map

### Loss
- **Condition:** City Hall HP reaches 0
- **Check:** In `CombatSystemComponent`, when City Hall component HP <= 0, trigger `GameManagerComponent.gameOver()`
- **Options:** Retry same map (restart from night 1) or return to menu

### Progression
- **Within map:** Money, buildings, units carry over between nights (persistent within 3-night session)
- **Between maps:** Full reset (new map starts fresh)
- **No meta-progression** (for MVP)

---

## 15. Map & Environment

### Map Layout
- **Ground plane:** PlaneGeometry (40×22 world units) with asphalt material
- **City Hall** at center (world origin 0,0,0)
- **Enemy spawn points:** 8-12 designated edge positions (N, S, E, W sides of map)

### Day/Night Lighting
- **Day mode:**
  - DirectionalLight (sun) intensity 1.0
  - AmbientLight intensity 0.4
- **Night mode:**
  - DirectionalLight intensity 0.2 (moon)
  - AmbientLight intensity 0.1
  - Vignette post-processing effect (darker edges)
- **Implementation:** `LightingManagerComponent` adjusts lights on state change

---

## 16. Out of Scope (MVP)

**These are BACKLOG for post-MVP:**
- Extra resources (Goods, Blueprints, GPUs, Staff, Research)
- Extra buildings (Residence, Farm, Sweatshop, Re-education Camp, Factory, Lab, AGI Lab, Dark Factory)
- Production chains
- Extra unit types (Robots, Tanks)
- Extra enemy types (Spies, Veterans, EVs, Tractors)
- Complex enemy AI behaviors (preferIndustry, unitHunter)
- Player Power scaling system
- Tech theft mechanic
- Barricades / barbed wire
- Abilities system (Q/W/E)
- Authority Energy
- Near-miss reward system
- Complex game feel effects (milestone celebrations, progressive intensity)
- Threat forecast panel
- Touch controls
- Soundtrack/voice acting
- Online features, leaderboards

---

## 17. Success Criteria (MVP)

### Technical
- [ ] Runs in **Kite3D game engine** with no console errors
- [ ] Scene designed in Kite Editor, exported as `.scene.glb`
- [ ] Components follow **Object3DComponent** pattern with proper lifecycle
- [ ] **Manager/System pattern** used (EnemySystem, UnitSystem, GameManager, etc.)
- [ ] All resources cleaned up in `stop()` and `destroy()` (no memory leaks)
- [ ] ES6 modules (`.script.js` files)

### Core Gameplay
- [ ] **Day/Night cycle** triggered by holding Space (3 sec min for day)
- [ ] Night ends automatically when all enemies defeated
- [ ] **3 nights to victory** per map
- [ ] Player can place buildings (Money Generator, Tire Repair Center) during day
- [ ] Buildings produce money passively
- [ ] City Hall destruction triggers Game Over

### Combat & Units
- [ ] **Robot Tire** accelerates toward mouse on click+hold
- [ ] Robot Tire collision with crowds deals massive damage (150-200)
- [ ] **Unit commands:** Select units, right-click for move+attack, shift+right-click for move+hold
- [ ] Police and FPV units follow orders and auto-engage based on priority
- [ ] Enemies move toward City Hall with target priority
- [ ] **Enemy spawn scaling:** Night 1 = 20, Night 2 = 35, Night 3 = 50 crowds

### Combat Feel (PRIORITY)
- [ ] **Dismemberment:** Crowds break into body parts on death
- [ ] **Ragdoll physics:** Body parts fly with physics simulation
- [ ] **Blood splatter:** Red decals/particles spawn on impact
- [ ] **Agony motions:** Crowds react when hit but not killed
- [ ] **Camera shake** on tire collision (scales with impact force)
- [ ] **Time dilation** (0.85× for 0.2sec) on multi-kill
- [ ] Collisions feel **chaotic and overwhelming**

### UI
- [ ] **Money counter** (top-left, always visible)
- [ ] **Minimap** (bottom-right, Starcraft-style: units, enemies, buildings, viewport)
- [ ] **Health bars** above all units/enemies/buildings (always visible)
- [ ] **Night/Enemy counter** (top-center during night)
- [ ] Controls legend accessible from menu

### Juice
- [ ] Material damage flash (red tint on hit)
- [ ] Selection pop animation (scale 1.0 → 1.08)
- [ ] Building placement preview (ghost mesh, green/red validation)
- [ ] Blood accumulates during night, clears on day transition
- [ ] Tire leaves track decals

---

## 18. Component File Structure (Recommended)

Organize code into these `.script.js` files:

**Core Systems:**
- `GameManager.script.js` - Game state, money, day/night cycle, victory/loss
- `InputManager.script.js` - Mouse/keyboard input, raycasting, unit selection, tire control

**Entity Systems:**
- `EnemySystem.script.js` - Spawns and updates all enemies, wave config
- `EnemyData.script.js` - Data component per enemy (HP, target, etc.)
- `UnitSystem.script.js` - Updates all units, processes orders, auto-engage
- `UnitData.script.js` - Data component per unit (HP, orders, target, etc.)
- `BuildingManager.script.js` - Tracks buildings, money production
- `BuildingData.script.js` - Data component per building (HP, type, etc.)

**Gameplay:**
- `CombatSystem.script.js` - Damage, collision detection, health management
- `RobotTireController.script.js` - Tire-specific control logic, acceleration toward mouse

**Gore & Effects:**
- `GoreSystem.script.js` - Dismemberment, ragdoll, blood splatter
- `EffectsManager.script.js` - Camera shake, time dilation, screen effects
- `LightingManager.script.js` - Day/night lighting changes

**UI:**
- `HudUI.script.js` - Money counter, night counter, prompts
- `MinimapUI.script.js` - Minimap rendering/updating
- `HealthBarUI.script.js` - Health bars over all entities

---

## 19. Implementation Priority Order

### Phase 1: Core Loop (Week 1)
1. Basic map, City Hall placement
2. Day/night state transitions (Space hold)
3. Money system + Money Generator building
4. Simple HUD (money counter, night counter)

### Phase 2: Basic Combat (Week 2)
1. Enemy spawn system (crowds only, simple spawn)
2. Enemy movement toward City Hall
3. Police unit placement + basic auto-attack
4. Health bars, damage system
5. City Hall destruction → Game Over

### Phase 3: Robot Tire (Week 3)
1. Robot Tire unit + mouse acceleration control
2. Tire-crowd collision detection
3. High damage on collision
4. Tire Repair Center building

### Phase 4: Unit Commands (Week 3-4)
1. Unit selection (click, drag-select)
2. Move + Auto-attack orders (right-click)
3. Move + Hold orders (Shift+right-click)
4. FPV drone unit

### Phase 5: Gore & Feel (Week 4-5)
1. Dismemberment system (body parts)
2. Ragdoll physics
3. Blood splatter decals/particles
4. Camera shake
5. Damage flash effects
6. Agony motions

### Phase 6: UI & Polish (Week 5-6)
1. Minimap implementation
2. Victory/loss screens
3. Menu screen
4. 3-night progression
5. Time dilation on multi-kill
6. Audio placeholder cues (visual)

---

## 20. MVP One-Sentence Goal

**"Survive 3 nights against rapid, random onslaughts of swarming crowds by running over them with your Robot Tire and commanding your police force—economics is easy, making fast calculated risky tactical maneuvers to counter crowd swarms in all directions without getting overwhelmed is not."**
