# Gameplay design

You play as the CCP police. Your duty is to prevent the City Hall from being destroyed. Each day you earn money by keeping your industry alive. Industry is constitued by production buildings - factories for physical goods and research labs for softwware. Defend your industry and strategically invest in sections of your industry to strengthen your police force. Each night, protestors aggregate and attempt to take Tienman sqaure. They also destroy industrial buildings indiscriminately, so defend against them.  

# Buildings 

Can place in any tile within valid tiles. Landscape is preset or RNG generated for difficulty. Start with 100 money.

## All buildings

- Residence (input: money | peace_output (with chance): 996 bro)
- Farm (input: money) 
- Sweatshop (input: within residential zone, farm)
- Re-education camp (input: prisoners | output: one of 'farmer', 'factory worker', 'office worker', 'member of technical staff', 'scientist', etc)
- Basic Factory (input: within sweatshop zone, road | output: FPVs, advanced factory comp)
- Basic Office  (input: within residential zone, road | output: GPU bp, advanced factory bp | peace_output: member of technical staff)
- Advanced Factory {'Humanoids', 'Tire', 'GPUs} (input: advanced facotry comp, advanced factory bp | output: by type)
- Lab {'AI', 'Bio'} (input: member of technical staff, GPUs | output: by type) 
- Dark Factory (upgrade name) --> some efficiency multiplier 
- AGI Lab (mandate of heaven) --> some efficiency multiplier

## Starting buildings

You also start with 5 points 

- City Hall
- Residence 
- Farm  

# Units

## All Units
- Robot tire -> spawn with, for extra unlock with advanced factory  
- FPV swarm -> unlock with 3d printers
- Humanoid police -> unlock with advanced factory
- Tank (final unlock) -> unlock with military academy

## Unit Behavior

You start out with some number of them depending on type, spawned next to their production building. For convenience, add spawn classes for each unit that can be added as components to objects with parameters for number of units. When the night begins, they implement A-star towards the enemy with target priority (nearest is deefault, impl this for now), and when within range they attack. 

// TODO LATER - add AI behavior upgrades for unit. 

# Abilities

- Hack CCTV
- EM interference (enemy coordination goes down)
- Chemical gas 

# Structures

- barbed wire
- concrete barricade 

# Enemies

Should have tiered enemy classes, with software & hardware adversarially matched to current police capability. They can also get it by destroying industrial centers (secret leaked) 

## All Enemies
- Crowd
- Spy (faster but weaker, gets behind lines and into industry, sabotages)
- Veteran (higher health, ranged attack, and sometimes organizes)
- EVs (high acceleration / medium mass, deadly when rammed, faster to turn)
- Tractor (high mass, deadly when rammed, but slow to turn)

## Enemy Behavior

Currently all enemy will implement A-star towards the center zone, but will prioritize switching onto the player as long as the player is within its detection range. 

# Enemy spawn logic 

Designated by game creator. For now, should be manually specifiable by adding enemy classes components to empty objects, and specificying the number of enemies to spawn. 

# Night/day logic

When the player presses down space for 5 seconds, the night begins. A large-font, red number should show up in the middle of the screen and countdown from 5, dissapear when the player cancels by releasing space. When night is initiated, spawn the enemies in all objects that have enemy class components. 

# TODO

More sophisticated enemy behavior. Currently all enemy will implement A-star towards the center zone, but will prioritize switching onto the player as long as the player is within its detection range. 
