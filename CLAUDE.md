There are sample examples of threepipe components in samples/*, read them

The game is using kite game engine built on top of threepipe and three.js.
•⁠  ⁠The game scene is designed in a UI editor and exported as .scene.glb files. These are binary files and cannot be read or edited as text.
•⁠  ⁠The game consists of objects in the scene like player, trees, enemies, weapons, etc. Each object is a three.js ⁠ Object3D ⁠ with ⁠ Object3DComponents ⁠ that extend the functionality of the objects.
•⁠  ⁠Custom components are used to add game-specific behavior to objects. For example, the ⁠ PlayerComponent ⁠ handles player movement and actions, while the ⁠ EnemyComponent ⁠ manages enemy AI. These components are defined in their dedicated .script.js files in the game folder and can be attached to the objects using the UI.
•⁠  ⁠Instruct the user to make changes to the 3D scene or to add or remove components from the game.
•⁠  ⁠Check node_modules/threepipe for the source code of threepipe and its plugins like ⁠ EntityComponentPlugin ⁠ etc.
•⁠  ⁠threepipe is based on three.js, any three.js export can be imported like ⁠ import * as THREE from 'three'; ⁠, for three.js addons, they need to be imported from threepipe like ⁠ import { SimplifyModifier } from 'threepipe'; ⁠(but its not required in most cases as the functionality is built into some plugin).
•⁠  ⁠The game includes a main.js file that is not used during development, so it not to be modified.