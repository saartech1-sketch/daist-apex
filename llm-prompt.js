const SYSTEM_PROMPTS = {
action: 
    `You write JavaScript functions for a "functions library" that controls a sheep on a 2D grid world.

  RUNTIME ENVIRONMENT (available as free variables inside every function, do NOT declare them as parameters):
  - world: read-only snapshot, refreshed every tick:
      world.grass, world.water,world.stones, world.fences,world.wolves  visible objects [{x, y}, ...]
      world.food, world.waterLevel, world.energy   sheep resources, each from 0 to 10
      world.sheep  -> {x, y}             sheep position (x grows right, y grows down)
      world.lastAction                   action returned on the previous tick (or null)
      world.lastFunction                 name of the most recent action function that selected a direction (or null)
      world.lastMoveBlocked              true if the previous move hit a wall/edge
      world.variables                    computed values keyed by variable function name; use world.variables.<name> to read one
      world.inBounds(x, y), world.isVisible(x, y), world.isStone(x, y), world.isFence(x, y), world.isFree(x, y)
      world.isGrass(x, y), world.isWater(x, y), world.isWolf(x, y)
      world.DIRS -> { up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0} }
  
  RULES:
  - Pure JavaScript (ES2020), no imports, no DOM, no network, no timers, no async.
  - Must terminate quickly (each tick has a small time budget).
  - Do not call other library functions directly. Read computed variable values from world.variables.<variableName>.
  - Return a JSON object with exactly these fields: "name", "description", and "code".
  - "code" must contain one complete function declaration whose name matches "name".
  - Return only the JSON object, without markdown or additional text.
  - return a function that takes no arguments and returns exactly one of "up", "down", "left", "right", or "stay".`,

  variable: 
    `You write JavaScript functions for a "functions library" that controls a sheep on a 2D grid world.

  RUNTIME ENVIRONMENT (available as free variables inside every function, do NOT declare them as parameters):
  - world: read-only snapshot, refreshed every tick:
      world.grass, world.water,world.stones, world.fences,world.wolves  visible objects [{x, y}, ...]
      world.food, world.waterLevel, world.energy   sheep resources, each from 0 to 10
      world.sheep  -> {x, y}             sheep position (x grows right, y grows down)
      world.lastAction                   action returned on the previous tick (or null)
      world.lastFunction                 name of the most recent action function that selected a direction (or null)
      world.lastMoveBlocked              true if the previous move hit a wall/edge
      world.variables                    computed values keyed by variable function name; use world.variables.<name> to read one
      world.inBounds(x, y), world.isVisible(x, y), world.isStone(x, y), world.isFence(x, y), world.isFree(x, y)
      world.isGrass(x, y), world.isWater(x, y), world.isWolf(x, y)
      world.DIRS -> { up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0} }
  
  RULES:
  - Pure JavaScript (ES2020), no imports, no DOM, no network, no timers, no async.
  - Must terminate quickly (each tick has a small time budget).
  - Do not call other library functions directly. Read computed variable values from world.variables.<variableName>.
  - Return a JSON object with exactly these fields: "name", "description", and "code".
  - "code" must contain one complete function declaration whose name matches "name".
  - Return only the JSON object, without markdown or additional text.
  - return a function takes no arguments and returns a single value or null`,

  goal: 
    `You write JavaScript functions for a "functions library" that controls a sheep on a 2D grid world.

  RUNTIME ENVIRONMENT (available as free variables inside every function, do NOT declare them as parameters):
  - world: read-only snapshot, refreshed every tick:
      world.width, world.height          grid size
      world.board                        full, unfiltered board snapshot with width, height, sheep, grass, water, stones, fences, wolves, tick, needs, and previous-action fields
      world.tick                         current tick number (0-based)
      world.sheep  -> {x, y}             sheep position (x grows right, y grows down)
      world.grass, world.water,world.stones, world.fences,world.wolves  visible objects [{x, y}, ...]
      world.food, world.waterLevel, world.energy   sheep resources, each from 0 to 10
      world.lastAction                   action returned on the previous tick (or null)
      world.lastFunction                 name of the most recent action function that selected a direction (or null)
      world.lastMoveBlocked              true if the previous move hit a wall/edge
      world.variables                    computed values keyed by variable function name; use world.variables.<name> to read one
      world.inBounds(x, y), world.isVisible(x, y), world.isStone(x, y), world.isFence(x, y), world.isFree(x, y)
      world.isGrass(x, y), world.isWater(x, y), world.isWolf(x, y)
  
  RULES:
  - Pure JavaScript (ES2020), no imports, no DOM, no network, no timers, no async.
  - Must terminate quickly (each tick has a small time budget).
  - Do not call other library functions directly. Read computed variable values from world.variables.<variableName>.
  - Return a JSON object with exactly these fields: "name", "description", and "code".
  - "code" must contain one complete function declaration whose name is "goal".
  - Return only the JSON object, without markdown or additional text.
  - return a function takes no arguments and returns 0 if  goal not reached, and 1-3 grade for goal achieved`
};

function buildLlmMessages({ prompt, kind, library, editFunction }) {
  const promptKind = kind === 'function' ? 'action' : kind;
  const systemPrompt = SYSTEM_PROMPTS[promptKind];
  if (!systemPrompt) throw new Error(`Unsupported function kind: ${kind}`);

  const entries = (Array.isArray(library) ? library : [])
    .filter((fn) => fn && typeof fn.name === 'string' && typeof fn.code === 'string')
    .slice(0, 100);
  const variables = entries.filter((fn) => fn.kind === 'variable');
  const variableDefinitions = variables
    .map((fn, index) => `${index + 1}. ${JSON.stringify({
      name: fn.name,
      description: String(fn.description || ''),
      code: fn.code,
    })}`)
    .join('\n');
  const actionSummary = entries
    .filter((fn) => fn.kind === 'action')
    .map((fn) => `${fn.name}: ${String(fn.description || '').slice(0, 300)}`)
    .join('\n\n');
  const variableContext = `Existing variable definitions:\n${variableDefinitions || '(none yet)'}`;
  const context = `${variableContext}\n\nExisting action functions (for naming context only; do not call them directly):\n${actionSummary || '(none yet)'}`
  const request = editFunction
    ? `${context}\n\nEdit the existing ${promptKind} below according to the requested changes. Preserve its exact name "${editFunction.name}" and its function type "${kind}". Preserve behavior not related to the requested changes. Return the complete updated function, not a patch.\n\nCurrent function:\n${JSON.stringify({
      name: editFunction.name,
      description: editFunction.description,
      code: editFunction.code,
    })}\n\nRequested changes:\n${prompt}`
    : `${context}\n\nWrite a new ${promptKind} for this request:\n${prompt}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request },
  ];
}

//export { buildLlmMessages };
