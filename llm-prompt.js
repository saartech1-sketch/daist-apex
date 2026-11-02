//import { PARAMS } from './params.js';

 const SYSTEM_PROMPT = `You write JavaScript functions for a "functions library" that controls a sheep on a 2D grid world.

RUNTIME ENVIRONMENT (available as free variables inside every function, do NOT declare them as parameters):
- world: read-only snapshot, refreshed every tick:
    world.width, world.height          grid size
    world.sheep  -> {x, y}             sheep position (x grows right, y grows down)
    world.grass, world.water           visible edible/drinkable objects [{x, y}, ...]
    world.stones, world.fences         visible impassable objects [{x, y}, ...]
    world.wolves                       visible roaming hazards [{x, y}, ...]
    world.board                        full, unfiltered board snapshot with width, height, sheep, grass, water, stones, fences, wolves, tick, needs, and previous-action fields
    world.tick                         current tick number (0-based)
    world.food, world.waterLevel, world.energy   sheep resources, each from 0 to ${PARAMS.gaugeMax}
    world.lastAction                   action returned on the previous tick (or null)
    world.lastFunction                   name of the most recent action function that selected a direction (or null)
    world.lastMoveBlocked              true if the previous move hit a wall/edge
    world.variables                    computed values keyed by variable function name; use world.variables.<name> to read one
    world.inBounds(x, y), world.isVisible(x, y), world.isStone(x, y), world.isFence(x, y), world.isFree(x, y)
    world.isGrass(x, y), world.isWater(x, y), world.isWolf(x, y)
    world.DIRS -> { up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0} }
- memory: a plain object that persists between ticks (reset when the world resets). Use it for state.
- log(...args): debug output shown in the UI.

FUNCTION TYPES:
- A variable function takes no arguments and returns a value. Every variable function is recalculated once each tick before actions, in the exact variable order supplied below. Its return value replaces world.variables.<itsName>. A reset clears all stored variable values.
- A variable may read only variables earlier than itself in that order. A reference to itself or a later variable reads a previous tick's cached value (or undefined on the first tick), not that variable's current-tick result. Never use a variable's own world.variables.<itsName> value to calculate its return value; calculate from world state and earlier variables instead.
- Variable results live in world.variables under their variable names and can be read directly inside action functions and later variable functions, for example: if (world.variables.blocked) return "stay"; Use the stored value; do not call it as blocked() or world.variables.blocked().
- An action function runs after every variable has been recalculated for the tick and may read their values through world.variables.<variableName>.
- An action function returns exactly one of "up", "down", "left", "right", or "stay". Actions are tried in priority order; returning "stay" skips to the next action. The first non-"stay" action is performed. If all actions return "stay", the sheep waits.
- A goal function takes no arguments and returns an integer grade from 0 to 3. It runs after the sheep's action each tick. Return 0 to continue; return 1, 2, or 3 to pass with that grade. Goal functions can read freshly computed world.variables and the full board through world.board.
- world.grass, world.water, world.stones, world.fences, and world.wolves contain visible objects only. Use world.board.<collection> to inspect all objects, including those outside visibility.

RULES:
- Pure JavaScript (ES2020), no imports, no DOM, no network, no timers, no async.
- Must terminate quickly (each tick has a small time budget).
- Do not call other library functions directly. Read computed variable values from world.variables.<variableName>.

Respond ONLY with a JSON object:
{"name": "camelCaseName", "description": "one sentence", "code": "function camelCaseName(params) { ... }"}
The "code" must be a single function declaration whose name equals "name".`;

 function buildLlmMessages({ prompt, kind, library, editFunction }) {
  const entries = (Array.isArray(library) ? library : [])
    .filter((fn) => fn && typeof fn.name === 'string' && typeof fn.code === 'string')
    .slice(0, 100);
  const variableDefinitions = entries
    .filter((fn) => fn.kind === 'variable')
    .map((fn, index) => `${index + 1}. ${JSON.stringify({
      name: fn.name,
      description: String(fn.description || ''),
      code: fn.code,
    })}`)
    .join('\n');
  const variablePosition = kind === 'variable' && editFunction
    ? entries.filter((fn) => fn.kind === 'variable').findIndex((fn) => fn.name === editFunction.name) + 1
    : null;
  const variableOrderNote = kind !== 'variable'
    ? ''
    : variablePosition > 0
      ? `The variable being edited stays at position ${variablePosition}; its code must not read itself or any variable listed at position ${variablePosition} or later.`
      : 'A new variable will be appended after the listed variables; it may read any of them, but no variable can read it until a later tick/order change.';
  const libSummary = entries
    .filter((fn) => fn.kind === 'action')
    .map((fn) => `${fn.name}: ${String(fn.description || '').slice(0, 300)}`)
    .join('\n\n');
  const goalSummary = entries
    .filter((fn) => fn.kind === 'goal')
    .map((fn) => `${fn.name}: ${String(fn.description || '').slice(0, 300)}`)
    .join('\n\n');
  const variableContext = `Existing variable definitions, in evaluation order (their code is authoritative):\n${variableDefinitions || '(none yet)'}\n${variableOrderNote}`;
  const returnContract = kind === 'variable'
    ? 'Write a variable function that returns a freshly computed value for action functions to read through world.variables. Do not read its own value or the value of any variable listed after it.'
    : kind === 'goal'
      ? 'Write a function named exactly "goal" that returns an integer grade from 0 to 3. Return 0 when the goal is not met; return 1, 2, or 3 for a passing grade. It runs after the action each tick and may inspect the entire board through world.board.'
      : 'Write an action function that returns exactly one direction: "up", "down", "left", "right", or "stay".';
  const context = `${variableContext}\n\nExisting action functions (for naming context only; do not call them directly):\n${libSummary || '(none yet)'}\n\nExisting goal functions (for naming context only; do not call them directly):\n${goalSummary || '(none yet)'}`;
  const request = editFunction
    ? `${context}\n\nEdit the existing ${kind} below according to the requested changes. Preserve its exact name "${editFunction.name}" and its function type "${kind}". Preserve behavior not related to the requested changes. Return the complete updated function, not a patch.\n\nCurrent function:\n${JSON.stringify({
      name: editFunction.name,
      description: editFunction.description,
      code: editFunction.code,
    })}\n\nRequested changes:\n${prompt}`
    : `The requested function type is "${kind}". ${returnContract}\n${context}\n\nWrite a function for this request:\n${prompt}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: request },
  ];
}
