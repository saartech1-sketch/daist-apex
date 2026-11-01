'use strict';
// Runs library code isolated from the page (no DOM). The main thread terminates this worker on timeout.

for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) {
  try {
    Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false });
  } catch {}
}

const DIRS = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -1 }),
  down: Object.freeze({ dx: 0, dy: 1 }),
  left: Object.freeze({ dx: -1, dy: 0 }),
  right: Object.freeze({ dx: 1, dy: 0 }),
});
const ACTIONS = new Set(['up', 'down', 'left', 'right', 'stay']);

const world = {};
const memory = {};
const libraryFunctions = Object.create(null);
const goalFunctions = Object.create(null);
let logs = [];

function fmt(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatResult(value) {
  try {
    const formatted = JSON.stringify(value);
    return formatted === undefined ? String(value) : formatted;
  } catch {
    return String(value);
  }
}

function log(...args) {
  if (logs.length < 50) logs.push(args.map(fmt).join(' ').slice(0, 500));
}

function setWorld(snapshot) {
  const variables = world.variables || Object.create(null);
  for (const k of Object.keys(world)) delete world[k];
  const allStones = new Set(snapshot.stones.map((c) => `${c.x},${c.y}`));
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < snapshot.width && y < snapshot.height;
  const isVisible = (x, y) => {
    if (!inBounds(x, y) || Math.hypot(x - snapshot.sheep.x, y - snapshot.sheep.y) >= snapshot.visibilityRange) {
      return false;
    }

    let lineX = snapshot.sheep.x;
    let lineY = snapshot.sheep.y;
    const dx = Math.abs(x - lineX);
    const sx = lineX < x ? 1 : -1;
    const dy = -Math.abs(y - lineY);
    const sy = lineY < y ? 1 : -1;
    let error = dx + dy;

    while (lineX !== x || lineY !== y) {
      if ((lineX !== snapshot.sheep.x || lineY !== snapshot.sheep.y)
        && allStones.has(`${lineX},${lineY}`)) return false;
      const twiceError = 2 * error;
      if (twiceError >= dy) {
        error += dy;
        lineX += sx;
      }
      if (twiceError <= dx) {
        error += dx;
        lineY += sy;
      }
    }
    return true;
  };
  const visible = (objects) => objects.filter((object) => isVisible(object.x, object.y));
  const stoneSet = new Set(visible(snapshot.stones).map((c) => `${c.x},${c.y}`));
  const fenceSet = new Set(visible(snapshot.fences).map((c) => `${c.x},${c.y}`));
  const grass = visible(snapshot.grass);
  const water = visible(snapshot.water);
  const stones = visible(snapshot.stones);
  const fences = visible(snapshot.fences);
  const wolves = visible(snapshot.wolves);
  const grassSet = new Set(grass.map((c) => `${c.x},${c.y}`));
  const waterSet = new Set(water.map((c) => `${c.x},${c.y}`));
  const wolfSet = new Set(wolves.map((c) => `${c.x},${c.y}`));
  const isBlocked = (x, y) => stoneSet.has(`${x},${y}`) || fenceSet.has(`${x},${y}`);
  Object.assign(world, snapshot, {
    board: {
      ...snapshot,
      grass: snapshot.grass.map((c) => ({ ...c })),
      water: snapshot.water.map((c) => ({ ...c })),
      stones: snapshot.stones.map((c) => ({ ...c })),
      fences: snapshot.fences.map((c) => ({ ...c })),
      wolves: snapshot.wolves.map((c) => ({ ...c })),
    },
    grass,
    water,
    stones,
    fences,
    wolves,
    DIRS,
    variables,
    inBounds,
    isVisible,
    isStone: (x, y) => stoneSet.has(`${x},${y}`),
    isFence: (x, y) => fenceSet.has(`${x},${y}`),
    isGrass: (x, y) => grassSet.has(`${x},${y}`),
    isWater: (x, y) => waterSet.has(`${x},${y}`),
    isWolf: (x, y) => wolfSet.has(`${x},${y}`),
    isBlocked,
    isFree: (x, y) => inBounds(x, y) && (!isVisible(x, y) || !isBlocked(x, y)),
  });
}

function loadLibrary(sourceFunctions) {
  for (const k of Object.keys(libraryFunctions)) delete libraryFunctions[k];
  for (const k of Object.keys(goalFunctions)) delete goalFunctions[k];
  const errors = [];
  for (const { name, code, kind } of sourceFunctions) {
    try {
      if (!['variable', 'action', 'goal'].includes(kind)) throw new Error(`"${name}" has invalid type "${kind}"`);
      const factory = new Function('world', 'memory', 'log', `"use strict";\n${code}\nreturn ${name};`);
      const fn = factory(world, memory, log);
      if (typeof fn !== 'function') throw new Error(`"${name}" is not a function`);
      const entries = kind === 'goal' ? goalFunctions : libraryFunctions;
      entries[name] = { fn, kind };
    } catch (err) {
      errors.push({ name, error: String(err?.message || err) });
    }
  }
  return errors;
}

self.onmessage = (e) => {
  const msg = e.data;
  logs = [];
  let results = [];
  let worldView = null;
  try {
    switch (msg.type) {
      case 'load': {
        const errors = loadLibrary(msg.functions);
        self.postMessage({ id: msg.id, ok: true, errors });
        break;
      }
      case 'reset': {
        for (const k of Object.keys(memory)) delete memory[k];
        if (world.variables) {
          for (const k of Object.keys(world.variables)) delete world.variables[k];
        }
        self.postMessage({ id: msg.id, ok: true });
        break;
      }
      case 'tick': {
        results = [];
        setWorld(msg.world);
        const activeVariables = new Set(msg.variables);
        for (const name of Object.keys(world.variables)) {
          if (!activeVariables.has(name)) delete world.variables[name];
        }
        worldView = {
          ...msg.world,
          grass: world.grass,
          water: world.water,
          stones: world.stones,
          fences: world.fences,
          wolves: world.wolves,
          variables: Object.fromEntries(
            Object.entries(world.variables).map(([name, value]) => [name, formatResult(value)]),
          ),
        };
        const variableErrors = [];
        for (const name of msg.variables) {
          const variable = libraryFunctions[name];
          if (!variable || variable.kind !== 'variable') {
            const error = `Variable "${name}" is not in the library`;
            results.push({ name, value: `Error: ${error}` });
            variableErrors.push(error);
            continue;
          }
          try {
            const value = variable.fn();
            world.variables[name] = value;
            const formattedValue = formatResult(value);
            worldView.variables[name] = formattedValue;
            results.push({ name, value: formattedValue });
          } catch (err) {
            const error = `Variable "${name}" failed: ${String(err?.message || err)}`;
            const formattedError = `Error: ${String(err?.message || err)}`;
            worldView.variables[name] = formattedError;
            results.push({ name, value: formattedError });
            variableErrors.push(error);
          }
        }
        if (variableErrors.length) throw new Error(variableErrors.join('\n'));
        for (const name of msg.actions) {
          const actionFn = libraryFunctions[name];
          if (!actionFn || actionFn.kind !== 'action') {
            const error = `Action "${name}" is not in the library`;
            results.push({ name, value: `Error: ${error}` });
            throw new Error(error);
          }
          let action;
          try {
            action = actionFn.fn();
          } catch (err) {
            results.push({ name, value: `Error: ${String(err?.message || err)}` });
            throw err;
          }
          results.push({ name, value: formatResult(action) });
          if (!ACTIONS.has(action)) {
            throw new Error(`Action "${name}" returned ${fmt(action)}; expected a direction: ${[...ACTIONS].join(', ')}.`);
          }
          if (action === 'stay') continue;
          self.postMessage({ id: msg.id, ok: true, action, actionName: name, logs, results, world: worldView });
          return;
        }
        self.postMessage({ id: msg.id, ok: true, action: 'stay', actionName: null, logs, results, world: worldView });
        break;
      }
      case 'evaluateGoals': {
        setWorld(msg.world);
        const goalResults = [];
        for (const name of msg.names) {
          const goal = goalFunctions[name];
          if (!goal) {
            throw new Error(`Goal "${name}" is not in the library`);
          }
          let value;
          try {
            value = goal.fn();
          } catch (err) {
            throw new Error(`Goal "${name}" failed: ${String(err?.message || err)}`);
          }
          if (!Number.isInteger(value) || value < 0 || value > 3) {
            throw new Error(`Goal "${name}" returned ${fmt(value)}; expected an integer grade from 0 to 3.`);
          }
          goalResults.push({ name, value: formatResult(value) });
        }
        self.postMessage({ id: msg.id, ok: true, results: goalResults, logs });
        break;
      }
      case 'evaluateGoal': {
        setWorld(msg.world);
        const factory = new Function(
          'world',
          'memory',
          'log',
          `"use strict";\n${msg.code}\nreturn goal;`,
        );
        const goalFn = factory(world, memory, log);
        if (typeof goalFn !== 'function') {
          throw new Error('Goal source must declare function goal().');
        }
        const value = goalFn();
        if (!Number.isInteger(value) || value < 0 || value > 3) {
          throw new Error(`Goal returned ${fmt(value)}; expected an integer grade from 0 to 3.`);
        }
        self.postMessage({ id: msg.id, ok: true, value, logs });
        break;
      }
      default:
        throw new Error(`Unknown message type ${msg.type}`);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.stack || err?.message || err), logs, results, world: worldView });
  }
};
