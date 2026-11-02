/*
import { LEVELS, parseLevel } from './levels.js';
import { PARAMS } from './params.js';
import { drawObjectIcon, Renderer } from './render.js';
import { Sandbox } from './sandbox.js';
import { buildLlmMessages } from './llm-prompt.js';
*/

const ACTIONS = ['up', 'down', 'left', 'right', 'stay'];
const MOVES = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], stay: [0, 0] };
const MAX_TICKS = 500;
const MAX_LOG = 300;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const STORAGE_BOARD = 'sheepworld.board';
const OBJECT_COLLECTIONS = {
  wolf: 'wolves',
  stone: 'stones',
  fence: 'fences',
  grass: 'grass',
  water: 'water',
};

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('world'),
  run: $('run-btn'),
  step: $('step-btn'),
  reset: $('reset-btn'),
  editBoard: $('edit-board-btn'),
  objectPalette: $('object-palette'),
  addFunction: $('add-function-btn'),
  functionsTab: $('functions-tab'),
  variablesTab: $('variables-tab'),
  worldTab: $('world-tab'),
  libraryPanel: $('library-panel'),
  worldPanel: $('world-panel'),
  showInactive: $('show-inactive'),
  showInactiveLabel: $('show-inactive-label'),
  showInactiveText: $('show-inactive-text'),
  worldValues: $('world-values'),
  worldValuesEmpty: $('world-values-empty'),
  worldValuesNote: $('world-values-note'),
  functionDialog: $('add-function-dialog'),
  goalDialog: $('goal-dialog'),
  goalStars: $('goal-stars'),
  speed: $('speed'),
  foodGauge: $('food-gauge'),
  foodValue: $('food-value'),
  waterGauge: $('water-gauge'),
  waterValue: $('water-value'),
  energyGauge: $('energy-gauge'),
  energyValue: $('energy-value'),
  status: $('status'),
  log: $('log'),
  dialogTitle: $('dialog-title'),
  draftHeading: $('draft-heading'),
  priorityHelp: $('priority-help'),
  apiTabs: [...document.querySelectorAll('.api-tab')],
  apiPanels: [...document.querySelectorAll('.api-tab-panel')],
  prompt: $('prompt'),
  generate: $('generate-btn'),
  genStatus: $('generate-status'),
  llmPromptDebug: $('llm-prompt-debug'),
  llmPrompt: $('llm-prompt'),
  draft: $('draft'),
  draftName: $('draft-name'),
  draftDesc: $('draft-desc'),
  draftCode: $('draft-code'),
  draftSave: $('draft-save'),
  draftDiscard: $('draft-discard'),
  draftDelete: $('draft-delete'),
  library: $('library'),
  goalCode : '',
};

const renderer = new Renderer(el.canvas);
const sandbox = new Sandbox(1000);

for (const buttonElement of el.objectPalette.querySelectorAll('[data-object-tool]')) {
  drawObjectIcon(buttonElement.querySelector('canvas'), buttonElement.dataset.objectTool);
}

el.foodGauge.max = PARAMS.gaugeMax;
el.waterGauge.max = PARAMS.gaugeMax;
el.energyGauge.max = PARAMS.gaugeMax;

let library = [];
let actionOrder = [];
let libraryReady = false;
let libraryErrors = new Map();
let libraryDirty = true;
let librarySyncPromise = null;
let librarySavePromise = Promise.resolve();
let lastTickResults = new Map();
let hasTickResults = false;
let lastWorldSnapshot = null;

let state;
let running = false;
let busy = false;
let goalDialogTimer = null;
let editingBoard = false;
let selectedObjectTool = 'grass';
let draggedObject = null;
let draggedActionName = null;
let activeLibraryTab = 'action';
const showInactiveByKind = { action: false, variable: false };
let editingFunctionName = null;
let editingFunctionSource = null;
let draftTemplateKind = 'action';

function loadStored(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function persistLibrary() {
  lastTickResults = new Map();
  hasTickResults = false;
  libraryDirty = true;
  renderLibrary();
  syncLibrary();
  saveUserLibrary();
}

function libraryPayload() {
  return library.map((entry, index) => ({
    name: entry.name,
    description: entry.description,
    code: entry.code,
    llmPrompt: entry.llmPrompt || '',
    active: entry.active !== false,
    kind: entry.kind,
    sortOrder: entry.kind === 'action' ? actionOrder.indexOf(entry.name) : index,
  }));
}

function saveUserLibrary() {
  const payload = JSON.stringify({ entries: libraryPayload() });
  console.log(`Saving user library: ${payload}`);

  librarySavePromise = librarySavePromise
    .then(() => window.parent.apex.server.process(
      'SAVE_USER_LIBRARY',
      { p_clob_01: payload },
      { dataType: 'text' },
    ))
    .catch((err) => addLog(`Library save failed: ${err.message}`, 'error'));
  return librarySavePromise;
}

async function loadUserLibrary() {
  const response = await window.parent.apex.server.process(
    'LOAD_USER_LIBRARY',
    {},
    { dataType: 'text' },
  );
  const entries = JSON.parse(response);
  if (!Array.isArray(entries) || entries.some((entry) => (
    !entry
    || typeof entry.name !== 'string'
    || (entry.description != null && typeof entry.description !== 'string')
    || typeof entry.code !== 'string'
    || (entry.llmPrompt != null && typeof entry.llmPrompt !== 'string')
    || (entry.active != null
      && typeof entry.active !== 'boolean'
      && !['Y', 'N'].includes(String(entry.active).toUpperCase()))
    || !['action', 'variable'].includes(entry.kind)
    || !Number.isInteger(entry.sortOrder)
  ))) {
    throw new Error('The server returned an invalid library.');
  }
  library = entries.map(({ name, description, code, llmPrompt, active, kind }) => ({
    name,
    description: description || '',
    code,
    llmPrompt: llmPrompt || '',
    active: active !== false && String(active).toUpperCase() !== 'N',
    kind,
  }));
  actionOrder = entries
    .filter((entry) => entry.kind === 'action')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => entry.name);
  normalizeActionOrder();
  renderLibrary();
  await syncLibrary();
}

function syncLibrary() {
  if (librarySyncPromise) return librarySyncPromise;
  if (!libraryDirty) return Promise.resolve(true);
  librarySyncPromise = (async () => {
    while (libraryDirty) {
      libraryDirty = false;
      try {
        const errors = await sandbox.load(library);
        libraryErrors = new Map(errors.map((e) => [e.name, e.error]));
      } catch (err) {
        libraryDirty = true;
        libraryErrors = new Map();
        addLog(`Library load failed: ${err.message}`, 'error');
        return false;
      }
    }
    return true;
  })().finally(() => {
    librarySyncPromise = null;
    renderLibrary();
  });
  return librarySyncPromise;
}

// ---------- World ----------

function resetWorld(clearMemory = true) {
  stop();
  window.clearTimeout(goalDialogTimer);
  goalDialogTimer = null;
  if (el.goalDialog.open) el.goalDialog.close();
  lastTickResults = new Map();
  hasTickResults = false;
  lastWorldSnapshot = null;
  state = {
    ...loadBoardLayout(),
    tick: 0,
    food: PARAMS.gaugeMax,
    waterLevel: PARAMS.gaugeMax,
    energy: PARAMS.gaugeMax,
    status: 'ready',
    currentFunction: null,
    lastAction: null,
    lastFunction: null,
    lastMoveBlocked: false,
    gatheringTicksRemaining: 0,
    gatheringResource: null,
  };
  renderer.resize(state.width, state.height);
  renderer.snapTo(state.sheep);
  el.log.replaceChildren();
  updateFunctionResultLabels();
  updateWorldValues();
  if (clearMemory) sandbox.reset().catch((err) => addLog(`Sandbox reset failed: ${err.message}`, 'error'));
  updateStatus();
}

function loadBoardLayout() {
  const fallback = parseLevel(LEVELS[0]);
  const saved = loadStored(STORAGE_BOARD, null);
  const collections = ['stones', 'fences', 'grass', 'water', 'wolves'];
  if (!saved
    || !Number.isInteger(saved.width) || saved.width < 1 || saved.width > 100
    || !Number.isInteger(saved.height) || saved.height < 1 || saved.height > 100
    || !saved.sheep || !collections.every((name) => Array.isArray(saved[name]))) return fallback;

  const positions = [saved.sheep, ...collections.flatMap((name) => saved[name])];
  if (positions.some((position) =>
    !position
    || !Number.isInteger(position.x) || !Number.isInteger(position.y)
    || position.x < 0 || position.y < 0
    || position.x >= saved.width || position.y >= saved.height)) return fallback;

  const uniquePositions = new Set(positions.map((position) => `${position.x},${position.y}`));
  if (uniquePositions.size !== positions.length) return fallback;

  return {
    width: saved.width,
    height: saved.height,
    sheep: { ...saved.sheep },
    ...Object.fromEntries(collections.map((name) => [name, saved[name].map((position) => ({ ...position }))])),
  };
}

function saveBoardLayout() {
  const board = {
    width: state.width,
    height: state.height,
    sheep: state.sheep,
    stones: state.stones,
    fences: state.fences,
    grass: state.grass,
    water: state.water,
    wolves: state.wolves,
  };
  localStorage.setItem(STORAGE_BOARD, JSON.stringify(board));
}

function snapshot() {
  return {
    width: state.width,
    height: state.height,
    visibilityRange: PARAMS.visibilityRange,
    sheep: { ...state.sheep },
    grass: state.grass.map((g) => ({ ...g })),
    water: state.water.map((w) => ({ ...w })),
    stones: state.stones.map((s) => ({ ...s })),
    fences: state.fences.map((f) => ({ ...f })),
    wolves: state.wolves.map((w) => ({ ...w })),
    tick: state.tick,
    food: state.food,
    waterLevel: state.waterLevel,
    energy: state.energy,
    lastAction: state.lastAction,
    lastFunction: state.lastFunction,
    lastMoveBlocked: state.lastMoveBlocked,
  };
}

function applyAction(action) {
  const [dx, dy] = MOVES[action];
  const nx = state.sheep.x + dx;
  const ny = state.sheep.y + dy;
  const inBounds = nx >= 0 && ny >= 0 && nx < state.width && ny < state.height;
  const blocked = action !== 'stay' && (
    !inBounds
    || state.stones.some((s) => s.x === nx && s.y === ny)
    || state.fences.some((f) => f.x === nx && f.y === ny)
  );

  if (!blocked) state.sheep = { x: nx, y: ny };
  else renderer.bump();
  renderer.setFacing(action);

  const grassBefore = state.grass.length;
  const waterBefore = state.water.length;
  state.grass = state.grass.filter((g) => g.x !== state.sheep.x || g.y !== state.sheep.y);
  state.water = state.water.filter((w) => w.x !== state.sheep.x || w.y !== state.sheep.y);
  const ateGrass = state.grass.length < grassBefore;
  const drankWater = state.water.length < waterBefore;
  if (ateGrass || drankWater) {
    state.gatheringTicksRemaining = PARAMS.resourceGatheringTicks - 1;
    state.gatheringResource = ateGrass ? 'grass' : 'water';
  }

  const moved = !blocked && action !== 'stay';
  const clampGauge = (value) => Math.max(0, Math.min(PARAMS.gaugeMax, value));
  state.food = clampGauge(state.food - PARAMS.foodPerTick + (ateGrass ? PARAMS.foodRestoredByGrass : 0));
  state.waterLevel = clampGauge(state.waterLevel - PARAMS.waterPerTick + (drankWater ? PARAMS.waterRestoredByWater : 0));
  state.energy = clampGauge(state.energy + (moved ? -PARAMS.energyPerMove : PARAMS.energyRestoredPerRest));
  let wolfCollision = state.wolves.some((wolf) => wolf.x === state.sheep.x && wolf.y === state.sheep.y);
  const occupiedByObstacle = (x, y) =>
    state.stones.some((s) => s.x === x && s.y === y)
    || state.fences.some((f) => f.x === x && f.y === y);
  if (!wolfCollision) {
    for (let i = 0; i < state.wolves.length; i++) {
      const wolf = state.wolves[i];
      for (let move = 0; move < PARAMS.wolfMovesPerTick; move++) {
        const options = [
          { x: wolf.x, y: wolf.y - 1 },
          { x: wolf.x, y: wolf.y + 1 },
          { x: wolf.x - 1, y: wolf.y },
          { x: wolf.x + 1, y: wolf.y },
        ].filter((p) =>
          p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height
          && !occupiedByObstacle(p.x, p.y)
          && !state.wolves.some((other, j) => j !== i && other.x === p.x && other.y === p.y)
        );
        if (options.length) {
          const next = options[Math.floor(Math.random() * options.length)];
          wolf.x = next.x;
          wolf.y = next.y;
        }
        if (wolf.x === state.sheep.x && wolf.y === state.sheep.y) {
          wolfCollision = true;
          break;
        }
      }
      if (wolfCollision) break;
    }
  }
  state.lastAction = action;
  state.lastMoveBlocked = blocked;
  state.tick++;
  return { blocked, ateGrass, drankWater, wolfCollision };
}

async function step() {
  if (busy || !['ready', 'running'].includes(state.status)) return false;
  busy = true;
  try {
    const current = state;
    let action = 'stay';
    let actionName = null;
    let gathering = false;
    if (state.gatheringTicksRemaining > 0) {
      gathering = true;
      const remaining = state.gatheringTicksRemaining;
      state.gatheringTicksRemaining--;
      state.currentFunction = `${state.gatheringResource === 'grass' ? 'Eating grass' : 'Drinking water'} (${remaining} tick${remaining === 1 ? '' : 's'} remaining)`;
    }

    if (!await syncLibrary()) return false;
    const variableNames = library
      .filter((fn) => fn.kind === 'variable' && fn.active)
      .map((fn) => fn.name);
    const activeActionOrder = actionOrder.filter((name) =>
      library.some((fn) => fn.name === name && fn.kind === 'action' && fn.active),
    );
    const res = await sandbox.tick(snapshot(), variableNames, gathering ? [] : activeActionOrder);
    if (state !== current) return false;
    updateFunctionResults(res.results || []);
    if (res.world) {
      lastWorldSnapshot = res.world;
      updateWorldValues();
    }
    for (const line of res.logs || []) addLog(`  log: ${line}`, 'user');
    if (!res.ok) return fail(`Runtime error: ${res.error}`);
    if (!ACTIONS.includes(res.action)) return fail(`Actions returned ${JSON.stringify(res.action)}; expected one of ${ACTIONS.join(', ')}.`);
    action = res.action;
    actionName = res.actionName;
    if (!gathering) {
      state.currentFunction = actionName;
      if (actionName) state.lastFunction = actionName;
    }

    const tick = state.tick;
    const { blocked, ateGrass, drankWater, wolfCollision } = applyAction(action);
    if (gathering && state.gatheringTicksRemaining === 0) state.gatheringResource = null;
    const source = actionName ? ` [${actionName}]` : ' [no function]';
    const gatheringStatus = gathering ? ` - ${state.currentFunction}` : '';
    addLog(`#${tick} ${action}${source}${blocked ? ' (blocked)' : ''}${ateGrass ? ' - ate grass!' : ''}${drankWater ? ' - drank water!' : ''}${gatheringStatus}`);

    const depletedResources = [
      ['Food', state.food],
      ['Water', state.waterLevel],
      ['Energy', state.energy],
    ].filter(([, value]) => value <= 0);
    if (wolfCollision || depletedResources.length > 0) {
      state.status = 'dead';
      if (wolfCollision) addLog('A wolf caught the sheep.', 'error');
      for (const [resource] of depletedResources) addLog(`The sheep ran out of ${resource.toLowerCase()}.`, 'error');
    } else if (state.tick >= MAX_TICKS) {
      state.status = 'limit';
      addLog(`Reached the ${MAX_TICKS}-tick simulation limit.`);
    } else {
      state.status = 'running';
    }
    const goalCode = el.goalCode;
    
    if (typeof goalCode === 'string' && goalCode.trim() && state.status !== 'dead') {
      const goalResult = await sandbox.evaluateGoal(goalCode, snapshot());
      if (state !== current) return false;
      for (const line of goalResult.logs || []) addLog(`  log: ${line}`, 'user');
      if (!goalResult.ok) return fail(`Goal check failed: ${goalResult.error}`);
      if (goalResult.value > 0) {
        state.status = 'won';
        state.goalGrade = goalResult.value;
        addLog(`Goal passed with grade ${goalResult.value}.`);
        showGoalDialog(goalResult.value);
        try {
          await window.parent.apex.server.process(
            'SAVE_GOAL',
            { x01: goalResult.value },
            { dataType: 'text' },
          );
        } catch (err) {
          addLog(`Goal score save failed: ${err.message}`, 'error');
        }
      }
    }
    updateStatus();
    return state.status === 'running';
  } catch (err) {
    return fail(err.message);
  } finally {
    busy = false;
  }
}

function fail(message) {
  addLog(message, 'error');
  state.status = 'failed';
  state.currentFunction = null;
  updateStatus();
  return false;
}

function showGoalDialog(grade) {
  window.clearTimeout(goalDialogTimer);
  el.goalStars.textContent = `${'★'.repeat(grade)}${'☆'.repeat(3 - grade)}`;
  el.goalStars.setAttribute('aria-label', `${grade} of 3 stars gained`);
  el.goalDialog.showModal();
  /*
  goalDialogTimer = window.setTimeout(() => {
    if (el.goalDialog.open) el.goalDialog.close();
    goalDialogTimer = null;
  }, 2500);
  */
}

async function run() {
  if (running) return stop();
  running = true;
  updateControls();
  while (running && (await step())) {
    await new Promise((r) => setTimeout(r, Number(el.speed.value)));
  }
  stop();
}

function stop() {
  running = false;
  updateControls();
}

function updateControls() {
  el.run.textContent = running ? 'Pause' : 'Run';
  el.step.disabled = running || editingBoard || !libraryReady;
  el.run.disabled = editingBoard || !libraryReady;
  el.editBoard.textContent = editingBoard ? 'Finish editing' : 'Edit board';
  el.objectPalette.hidden = !editingBoard;
  el.canvas.classList.toggle('editing', editingBoard);
  if (!editingBoard) el.canvas.classList.remove('can-drag', 'dragging');
}

function updateStatus() {
  const labels = { ready: 'Ready', running: 'Running', limit: 'Simulation limit reached', dead: 'The sheep died', won: 'Goal reached', failed: 'Stopped' };
  const functionStatus = state.status === 'won'
    ? `${state.goalGrade} Stars!`
    : state.currentFunction ? `Function: ${state.currentFunction}` : 'No function performed';
  el.status.textContent = `${labels[state.status]} - ${functionStatus}`;
  el.status.className = `status ${state.status === 'won' ? 'win' : state.status === 'dead' || state.status === 'failed' ? 'fail' : ''}`;
  for (const [name, gauge, output] of [
    ['food', el.foodGauge, el.foodValue],
    ['waterLevel', el.waterGauge, el.waterValue],
    ['energy', el.energyGauge, el.energyValue],
  ]) {
    gauge.value = state[name];
    output.value = `${state[name].toFixed(2)} / ${PARAMS.gaugeMax}`;
    gauge.classList.toggle('warning', state[name] < 5 && state[name] >= 2);
    gauge.classList.toggle('critical', state[name] < 2);
  }
}

function addLog(text, kind = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (kind) li.className = kind;
  el.log.append(li);
  while (el.log.children.length > MAX_LOG) el.log.firstChild.remove();
  el.log.scrollTop = el.log.scrollHeight;
}

// ---------- Library UI ----------

function renderLibrary() {
  const showingWorld = activeLibraryTab === 'world';
  const allEntries = activeLibraryTab === 'variable'
    ? library.filter((fn) => fn.kind === 'variable')
    : actionOrder.map((name) => library.find((fn) => fn.name === name && fn.kind === 'action')).filter(Boolean);
  const inactiveCount = allEntries.filter((fn) => fn.active === false).length;
  const ordered = showInactiveByKind[activeLibraryTab]
    ? allEntries
    : allEntries.filter((fn) => fn.active !== false);
  if (ordered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = inactiveCount > 0
      ? `No active ${activeLibraryTab === 'variable' ? 'variables' : 'functions'}. Show inactive entries below.`
      : activeLibraryTab === 'variable' ? 'No variables yet.' : 'No functions yet.';
    el.library.replaceChildren(empty);
  } else {
    el.library.replaceChildren(
      ...ordered.map(renderFunctionItem),
    );
  }
  updateFunctionResultLabels();
  const showingVariables = activeLibraryTab === 'variable';
  const showingEntries = activeLibraryTab === 'action' || showingVariables;
  el.functionsTab.setAttribute('aria-selected', String(activeLibraryTab === 'action'));
  el.functionsTab.tabIndex = activeLibraryTab === 'action' ? 0 : -1;
  el.variablesTab.setAttribute('aria-selected', String(showingVariables));
  el.variablesTab.tabIndex = showingVariables ? 0 : -1;
  el.worldTab.setAttribute('aria-selected', String(showingWorld));
  el.worldTab.tabIndex = showingWorld ? 0 : -1;
  el.libraryPanel.hidden = showingWorld;
  el.worldPanel.hidden = !showingWorld;
  el.addFunction.hidden = showingWorld;
  el.showInactiveLabel.hidden = !showingEntries;
  el.showInactive.checked = showingEntries && showInactiveByKind[activeLibraryTab];
  el.showInactiveText.textContent = `Show inactive${inactiveCount ? ` (${inactiveCount})` : ''}`;
  el.libraryPanel.setAttribute('aria-labelledby', showingVariables ? 'variables-tab' : 'functions-tab');
  el.worldPanel.setAttribute('aria-labelledby', 'world-tab');
}

function selectLibraryTab(kind) {
  activeLibraryTab = kind;
  renderLibrary();
  if (kind === 'world') updateWorldValues();
}

function renderFunctionItem(fn) {
  const li = document.createElement('li');
  li.dataset.functionName = fn.name;
  li.dataset.functionKind = fn.kind;
  li.draggable = fn.kind === 'action';
  const error = libraryErrors.get(fn.name);
  if (error) li.classList.add('has-error');
  if (!fn.active) li.classList.add('inactive');

  const card = document.createElement('div');
  card.className = 'function-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  console.log(fn);
  card.setAttribute('aria-label', `Edit ${fn.kind}`);
  card.addEventListener('click', () => openFunctionEditDialog(fn));
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFunctionEditDialog(fn);
  });
  const name = document.createElement('span');
  name.className = 'fn-name';
  name.textContent = fn.name;
  card.append(name);
  const desc = document.createElement('span');
  desc.className = 'fn-desc';
  desc.textContent = fn.description;
  card.append(desc);
  const result = document.createElement('span');
  result.className = 'fn-result';
  result.dataset.resultFor = fn.name;
  card.append(result);

  if (error) {
    const p = document.createElement('p');
    p.className = 'fn-error';
    p.textContent = error;
    card.append(p);
  }

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'function-toggle';
  toggle.textContent = fn.active ? 'Active' : 'Inactive';
  toggle.setAttribute('aria-pressed', String(fn.active));
  toggle.setAttribute('aria-label', `${fn.active ? 'Deactivate' : 'Activate'} ${fn.kind} ${fn.name}`);
  toggle.addEventListener('click', () => {
    fn.active = !fn.active;
    normalizeActionOrder();
    persistLibrary();
  });
  li.append(card, toggle);
  return li;
}

function updateFunctionResults(results) {
  lastTickResults = new Map(results.map(({ name, value }) => [name, value]));
  hasTickResults = true;
  updateFunctionResultLabels();
}

function updateFunctionResultLabels() {
  for (const item of el.library.querySelectorAll('li[data-function-name]')) {
    const result = item.querySelector('.fn-result');
    if (!result) continue;
    const name = item.dataset.functionName;
    if (lastTickResults.has(name)) {
      const value = String(lastTickResults.get(name));
      result.textContent = `Latest value: ${value}`;
      result.title = value;
    } else {
      result.textContent = hasTickResults ? 'Not run this tick' : 'Not run yet';
      result.removeAttribute('title');
    }
    const typeLabel = item.dataset.functionKind === 'variable' ? 'variable' : 'function';
    item.querySelector('.function-card')?.setAttribute(
      'aria-label',
      `Edit ${typeLabel} ${name}. ${result.textContent}`,
    );
  }
}

function updateWorldValues() {
  const snapshot = lastWorldSnapshot;
  el.worldValues.replaceChildren();
  el.worldValuesEmpty.hidden = Boolean(snapshot);
  el.worldValuesNote.hidden = !snapshot;
  if (!snapshot) return;
  const sections = [
    ['Simulation', ['tick', 'width', 'height', 'visibilityRange']],
    ['Sheep', ['sheep', 'food', 'waterLevel', 'energy']],
    ['Visible objects', ['grass', 'water', 'stones', 'fences', 'wolves']],
    ['Previous tick', ['lastAction', 'lastFunction', 'lastMoveBlocked']],
  ];
  for (const [title, names] of sections) {
    const heading = document.createElement('h3');
    heading.className = 'world-values-heading';
    heading.textContent = title;
    el.worldValues.append(heading);
    for (const name of names) {
      if (!(name in snapshot)) continue;
      appendWorldValue(`world.${name}`, snapshot[name]);
    }
  }
  const heading = document.createElement('h3');
  heading.className = 'world-values-heading';
  heading.textContent = 'Computed variables';
  el.worldValues.append(heading);
  const variables = Object.entries(snapshot.variables || {});
  if (variables.length === 0) appendWorldValue('world.variables', '(none)');
  for (const [name, value] of variables) appendWorldValue(`world.variables.${name}`, value);
}

function appendWorldValue(name, value) {
  const term = document.createElement('dt');
  const code = document.createElement('code');
  code.textContent = name;
  term.append(code);
  const description = document.createElement('dd');
  description.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  el.worldValues.append(term, description);
}

function button(text, onClick, className = '', disabled = false) {
  const b = document.createElement('button');
  b.textContent = text;
  if (className) b.className = className;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

async function formatCode(textarea, status) {
  status.textContent = 'Formatting...';

  try {
    if (!window.prettier || !window.prettierPlugins) {
      throw new Error('Prettier failed to load');
    }

    textarea.value = await window.prettier.format(textarea.value, {
      parser: 'babel',
      plugins: [
        window.prettierPlugins.babel,
        window.prettierPlugins.estree,
      ],
      semi: true,
      singleQuote: true,
      tabWidth: 2,
    });

    status.textContent = '';
    return true;
  } catch (err) {
    status.textContent = `Format error: ${err.message}`;
    return false;
  }
}

function reorderActions(sourceName, targetName, insertAfter) {
  const sourceIndex = actionOrder.indexOf(sourceName);
  const targetIndex = actionOrder.indexOf(targetName);
  if (sourceIndex < 0 || targetIndex < 0 || sourceName === targetName) return;
  const [name] = actionOrder.splice(sourceIndex, 1);
  const adjustedTargetIndex = actionOrder.indexOf(targetName);
  actionOrder.splice(adjustedTargetIndex + Number(insertAfter), 0, name);
  normalizeActionOrder();
  persistLibrary();
}

function normalizeActionOrder() {
  const actionNames = library
    .filter((fn) => fn.kind === 'action')
    .map((fn) => fn.name);
  const actionNameSet = new Set(actionNames);
  const activeNames = actionOrder.filter((name) =>
    actionNameSet.has(name) && library.some((fn) => fn.name === name && fn.active !== false),
  );
  const orderedNames = new Set(activeNames);
  const missingActiveNames = actionNames.filter((name) =>
    !orderedNames.has(name) && library.some((fn) => fn.name === name && fn.active !== false),
  );
  const inactiveNames = actionNames
    .filter((name) => library.some((fn) => fn.name === name && fn.active === false))
    .sort((a, b) => a.localeCompare(b));
  actionOrder = [...activeNames, ...missingActiveNames, ...inactiveNames];
}

function boardCell(event) {
  const rect = el.canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * state.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * state.height / rect.height);
  return x >= 0 && y >= 0 && x < state.width && y < state.height ? { x, y } : null;
}

function objectAt(cell) {
  if (state.sheep.x === cell.x && state.sheep.y === cell.y) return { type: 'sheep', object: state.sheep };
  for (const [type, collectionName] of Object.entries(OBJECT_COLLECTIONS)) {
    const collection = state[collectionName];
    const object = collection.find((item) => item.x === cell.x && item.y === cell.y);
    if (object) return { type, object };
  }
  return null;
}

function canPlaceObject(type, cell, movingObject = null) {
  if (cell.x < 0 || cell.y < 0 || cell.x >= state.width || cell.y >= state.height) return false;
  if (type !== 'stones' && type !== 'fences' && (state.stones.some((s) => s.x === cell.x && s.y === cell.y)
    || state.fences.some((f) => f.x === cell.x && f.y === cell.y))) return false;
  if (state.sheep !== movingObject && state.sheep.x === cell.x && state.sheep.y === cell.y) return false;
  for (const collection of [state.wolves, state.stones, state.fences, state.grass, state.water]) {
    if (collection.some((item) => item !== movingObject && item.x === cell.x && item.y === cell.y)) return false;
  }
  return true;
}

function removeObjectAt(cell) {
  return removeObject(objectAt(cell));
}

function removeObject(found) {
  if (!found || found.type === 'sheep') return;
  const collection = state[OBJECT_COLLECTIONS[found.type]];
  collection.splice(collection.indexOf(found.object), 1);
}

function placeObject(type, cell) {
  if (type === 'erase') {
    removeObjectAt(cell);
    return true;
  }
  if (type === 'sheep') {
    if (!canPlaceObject('sheep', cell, state.sheep)) return false;
    state.sheep.x = cell.x;
    state.sheep.y = cell.y;
    renderer.snapTo(cell);
    return true;
  }
  const collectionName = OBJECT_COLLECTIONS[type];
  if (!canPlaceObject(collectionName, cell)) return false;
  state[collectionName].push({ ...cell });
  return true;
}

function moveObject(drag, cell) {
  if (drag.type === 'sheep') {
    if (!canPlaceObject('sheep', cell, drag.object)) return;
    drag.object.x = cell.x;
    drag.object.y = cell.y;
    renderer.snapTo(cell);
    return;
  }
  const collectionName = OBJECT_COLLECTIONS[drag.type];
  if (!canPlaceObject(collectionName, cell, drag.object)) return;
  drag.object.x = cell.x;
  drag.object.y = cell.y;
}

function selectObjectTool(tool) {
  selectedObjectTool = tool;
  for (const buttonElement of el.objectPalette.querySelectorAll('[data-object-tool]')) {
    buttonElement.setAttribute('aria-pressed', String(buttonElement.dataset.objectTool === tool));
  }
}

function showDraft({ name, description, code, kind = draftTemplateKind, llmPrompt = '' }) {
  el.draftName.value = name;
  el.draftDesc.value = description;
  el.draftCode.value = code;
  el.llmPrompt.value = llmPrompt;
  el.llmPromptDebug.open = Boolean(llmPrompt);
  draftTemplateKind = kind;
  el.draft.hidden = false;
}

function libraryTypeLabel(kind) {
  return kind === 'variable' ? 'variable' : 'function';
}

function libraryTypeHint(kind) {
  return kind === 'variable'
    ? 'Describe what value this variable should calculate'
    : 'Describe what this function should do';
}

function updatePriorityHelp(kind) {
  el.priorityHelp.textContent = kind === 'variable'
    ? 'Every variable is evaluated before the functions each tick. Its result is available as world.variables.variableName and overwrites its stored value. Variables are not cleared before recalculation, but reset clears them.'
    : "Functions run in priority order after variables are evaluated. Returning 'stay' skips to the next function; the first direction returned is performed. If all return 'stay', the sheep waits. Drag functions in the library to change their order.";
}

function selectApiTab(tabName, focus = false) {
  for (const tab of el.apiTabs) {
    const selected = tab.id === `api-${tabName}-tab`;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of el.apiPanels) {
    panel.hidden = panel.id !== `api-${tabName}-panel`;
  }
}

async function generate() {
  const prompt = el.prompt.value.trim();
  if (!prompt) return;
  el.generate.disabled = true;
  el.genStatus.textContent = 'Asking the LLM...';
  el.llmPrompt.value = 'Waiting for the server to assemble the prompt...';
  el.llmPromptDebug.open = true;
  try {
    const requestedName = el.draftName.value.trim();
    if (!IDENT.test(requestedName)) throw new Error('Name must be a valid JavaScript identifier.');
    const editFunction = editingFunctionSource
      ? {
        ...editingFunctionSource,
        name: requestedName,
        description: el.draftDesc.value.trim(),
        code: requestedName === editingFunctionSource.name
          ? el.draftCode.value
          : renameFunctionDeclaration(el.draftCode.value, requestedName),
      }
      : null;
    if (editingFunctionName && !editFunction) throw new Error('The function being edited no longer exists.');
    const generationRequest = {
      prompt,
      kind: draftTemplateKind,
      library,
      ...(editFunction ? { editFunction } : {}),
    };
    
    const messages = buildLlmMessages(generationRequest);
    let savedLlmPrompt = JSON.stringify(messages, null, 2);
    el.llmPrompt.value = savedLlmPrompt;

    console.log('LLM PROMPT:' + JSON.stringify({ messages }));
    const res = await window.parent.apex.server.process(
    'GENERATE_FUNCTION',
    { p_clob_01: JSON.stringify({ messages }) },
    { dataType: 'text' },
    );

    const data = JSON.parse(res);
    if (data.error) throw new Error(data.error);
    
    if (typeof data.debugPrompt === 'string') {
      savedLlmPrompt = data.debugPrompt;
      el.llmPromptDebug.open = true;
    }
    
    //if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    
    showDraft({ ...data, llmPrompt: savedLlmPrompt });
    const formatted = await formatCode(el.draftCode, el.genStatus);
    if (formatted) {
      const typeLabel = libraryTypeLabel(draftTemplateKind);
      el.genStatus.textContent = editFunction
        ? `Review the edited ${typeLabel}, then save your changes.`
        : `Review the ${typeLabel} draft, then add it to the library.`;
    }
  } catch (err) {
    el.genStatus.textContent = `Error: ${err.message}`;
  } finally {
    el.generate.disabled = false;
  }
}

function saveDraft() {
  const name = el.draftName.value.trim();  
  if (!IDENT.test(name)) return alert('Name must be a valid JavaScript identifier.');

  if (name === 'goal'){
    apex.item("P1_GOAL_FUNC").setValue(el.draftCode.value);
    apex.item("P1_GOAL_PROMPT").setValue(el.prompt.value);
    el.functionDialog.close();
    return;
  }
  const existing = library.findIndex((f) => f.name === name);
  if (editingFunctionName && name !== editingFunctionName && existing >= 0) {
    el.genStatus.textContent = `An entry named "${name}" already exists.`;
    return;
  }
  let code = el.draftCode.value;
  if (editingFunctionName && name !== editingFunctionName) {
    try {
      code = renameFunctionDeclaration(code, name);
    } catch (err) {
      el.genStatus.textContent = err.message;
      return;
    }
  }
  const fn = {
    name,
    description: el.draftDesc.value.trim(),
    code,
    llmPrompt: el.prompt.value,
    active: editingFunctionSource
      ? editingFunctionSource.active !== false
      : existing >= 0 ? library[existing].active !== false : true,
    kind: draftTemplateKind,
  };
  if (editingFunctionName) {
    const originalIndex = library.findIndex((f) => f.name === editingFunctionName);
    if (originalIndex < 0) {
      el.genStatus.textContent = 'The function being edited no longer exists.';
      return;
    }
    library[originalIndex] = fn;
    if (name !== editingFunctionName) {
      actionOrder = actionOrder.map((item) => item === editingFunctionName ? name : item);
      library = library.map((item) => ({
        ...item,
        code: updateNameReferences(item.code, editingFunctionName, name, item.kind),
      }));
    }
  } else if (existing >= 0) {
    if (!confirm(`Replace existing function "${name}"?`)) return;
    actionOrder = actionOrder.filter((item) => item !== name);
    library[existing] = fn;
  } else {
    library.push(fn);
  }
  if (fn.kind === 'action' && !actionOrder.includes(name)) actionOrder.push(name);
  normalizeActionOrder();
  el.draft.hidden = true;
  el.prompt.value = '';
  el.genStatus.textContent = '';
  persistLibrary();
  el.functionDialog.close();
  editingFunctionName = null;
  editingFunctionSource = null;
  el.dialogTitle.textContent = 'Add new function';
  el.draftHeading.textContent = 'Function details';
  el.draftSave.textContent = 'Add to library';
  el.draftDelete.hidden = true;
  el.draftName.readOnly = false;
}

function openNewFunctionDialog() {
  editingFunctionName = null;
  editingFunctionSource = null;
  const typeLabel = libraryTypeLabel(activeLibraryTab);
  const capitalizedType = `${typeLabel[0].toUpperCase()}${typeLabel.slice(1)}`;
  el.dialogTitle.textContent = `Add new ${typeLabel}`;
  el.draftHeading.textContent = `${capitalizedType} details`;
  updatePriorityHelp(activeLibraryTab);
  selectApiTab(activeLibraryTab === 'variable' ? 'variables' : 'functions');
  el.draftSave.textContent = 'Add to library';
  el.draftDelete.hidden = true;
  el.draftName.readOnly = false;
  el.prompt.value = '';
  el.llmPrompt.value = '';
  el.llmPromptDebug.open = false;
  el.prompt.placeholder = libraryTypeHint(activeLibraryTab);
  el.genStatus.textContent = '';
  draftTemplateKind = activeLibraryTab;
  el.draft.hidden = false;
  el.draftName.value = 'myFunction';
  el.draftDesc.value = '';
  el.draftCode.value = functionTemplate(activeLibraryTab);
  el.functionDialog.showModal();
}

function renameFunctionDeclaration(code, name) {
  const declaration = /\bfunction\s+[$A-Z_a-z][$\w]*(?=\s*\()/;
  if (!declaration.test(code)) {
    throw new Error('Could not rename the function: no function declaration was found in the code.');
  }
  return code.replace(declaration, (match) => match.replace(/[$A-Z_a-z][$\w]*$/, name));
}

function updateNameReferences(code, oldName, newName, kind) {
  const escapedName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (kind === 'variable') {
    code = code.replace(
      new RegExp(`(\\bworld\\s*\\.\\s*variables\\s*\\.\\s*)${escapedName}\\b`, 'g'),
      (match, prefix) => `${prefix}${newName}`,
    );
    code = code.replace(
      new RegExp(`(\\bworld\\s*\\.\\s*variables\\s*\\[\\s*)(['"])${escapedName}\\2(\\s*\\])`, 'g'),
      (match, prefix, quote, suffix) => `${prefix}${quote}${newName}${quote}${suffix}`,
    );
  }
  return code.replace(
    new RegExp(`(\\bworld\\s*\\.\\s*lastFunction\\s*(?:===?|!==?)\\s*['"])${escapedName}(['"])`, 'g'),
    (match, prefix, suffix) => `${prefix}${newName}${suffix}`,
  );
}

function functionTemplate(kind) {
  return kind === 'variable'
    ? 'function myFunction() {\n  return 0;\n}'
    : "function myFunction() {\n  return 'stay';\n}";
}

function openFunctionEditDialog(fn) {
  editingFunctionName = fn.name;
  editingFunctionSource = { ...fn };
//  const typeLabel = libraryTypeLabel(fn.kind);
  const typeLabel = fn.kind;
  const capitalizedType = `${typeLabel[0].toUpperCase()}${typeLabel.slice(1)}`;
  el.dialogTitle.textContent = `Edit ${typeLabel}: ${fn.name}`;
  el.draftHeading.textContent = capitalizedType;
  updatePriorityHelp(fn.kind);
  selectApiTab(fn.kind === 'variable' ? 'variables' : 'functions');
  el.draftSave.textContent = 'Save changes';
  el.draftDelete.hidden = false;
  draftTemplateKind = fn.kind;
  el.draftName.readOnly = false;
  el.prompt.value = fn.llmPrompt || '';
  el.llmPrompt.value = '';
  el.llmPromptDebug.open = false;
  el.prompt.placeholder = `Describe how you want to change this ${typeLabel}`;
  el.genStatus.textContent = 'Edit the fields directly or describe a change for the LLM.';
  el.draft.hidden = false;
  el.draftName.value = fn.name;
  el.draftDesc.value = fn.description;
  el.draftCode.value = fn.code;
  el.llmPrompt.value = '';
  el.llmPromptDebug.open = Boolean(fn.llmPrompt);
  el.functionDialog.showModal();
}

function discardFunctionDraft() {
  el.functionDialog.close();
  editingFunctionName = null;
  editingFunctionSource = null;
  el.dialogTitle.textContent = 'Add new function';
  el.draftHeading.textContent = 'Draft';
  el.draftSave.textContent = 'Add to library';
  el.draftName.readOnly = false;
  el.draftDelete.hidden = true;
}

function deleteEditingFunction() {
  if (!editingFunctionName || !confirm(`Delete "${editingFunctionName}"?`)) return;
  const index = library.findIndex((fn) => fn.name === editingFunctionName);
  if (index < 0) {
    el.genStatus.textContent = 'The function being deleted no longer exists.';
    return;
  }
  library.splice(index, 1);
  actionOrder = actionOrder.filter((name) => name !== editingFunctionName);
  normalizeActionOrder();
  persistLibrary();
  discardFunctionDraft();
}

// ---------- Wiring ----------

el.run.addEventListener('click', run);
el.step.addEventListener('click', step);
el.reset.addEventListener('click', resetWorld);
el.addFunction.addEventListener('click', openNewFunctionDialog);
el.functionsTab.addEventListener('click', () => selectLibraryTab('action'));
el.variablesTab.addEventListener('click', () => selectLibraryTab('variable'));
el.worldTab.addEventListener('click', () => selectLibraryTab('world'));
el.showInactive.addEventListener('change', () => {
  if (activeLibraryTab !== 'action' && activeLibraryTab !== 'variable') return;
  showInactiveByKind[activeLibraryTab] = el.showInactive.checked;
  renderLibrary();
});
const libraryTabs = [el.functionsTab, el.variablesTab, el.worldTab];
for (const tab of libraryTabs) {
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = libraryTabs.indexOf(tab);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? libraryTabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : libraryTabs.length - 1)) % libraryTabs.length;
    const nextTab = libraryTabs[nextIndex];
    selectLibraryTab(nextIndex === 0 ? 'action' : nextIndex === 1 ? 'variable' : 'world');
    nextTab.focus();
  });
}
for (const tab of el.apiTabs) {
  tab.addEventListener('click', () => selectApiTab(tab.id.replace(/^api-|-tab$/g, '')));
  tab.addEventListener('keydown', (event) => {
    const index = el.apiTabs.indexOf(tab);
    const nextIndex = event.key === 'ArrowRight'
      ? (index + 1) % el.apiTabs.length
      : event.key === 'ArrowLeft'
        ? (index + el.apiTabs.length - 1) % el.apiTabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? el.apiTabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTabName = el.apiTabs[nextIndex].id.replace(/^api-|-tab$/g, '');
    selectApiTab(nextTabName, true);
  });
}
el.library.addEventListener('dragstart', (event) => {
  const item = event.target instanceof Element ? event.target.closest('li[data-function-kind="action"]') : null;
  if (!item || event.target.closest('input, textarea, select, button') || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  draggedActionName = item.dataset.functionName;
  item.classList.add('dragging');
  event.dataTransfer.setData('text/plain', draggedActionName);
  event.dataTransfer.effectAllowed = 'move';
});
el.library.addEventListener('dragover', (event) => {
  const target = event.target instanceof Element ? event.target.closest('li[data-function-kind="action"]') : null;
  if (!draggedActionName || !target || target.dataset.functionName === draggedActionName) return;
  event.preventDefault();
  for (const item of el.library.querySelectorAll('.drop-before, .drop-after')) {
    item.classList.remove('drop-before', 'drop-after');
  }
  const insertAfter = event.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
  target.classList.add(insertAfter ? 'drop-after' : 'drop-before');
  event.dataTransfer.dropEffect = 'move';
});
el.library.addEventListener('drop', (event) => {
  const target = event.target instanceof Element ? event.target.closest('li[data-function-kind="action"]') : null;
  if (!draggedActionName || !target || target.dataset.functionName === draggedActionName) return;
  event.preventDefault();
  const insertAfter = event.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
  const sourceName = draggedActionName;
  draggedActionName = null;
  reorderActions(sourceName, target.dataset.functionName, insertAfter);
});
el.library.addEventListener('dragend', () => {
  draggedActionName = null;
  for (const item of el.library.querySelectorAll('.dragging, .drop-before, .drop-after')) {
    item.classList.remove('dragging', 'drop-before', 'drop-after');
  }
});
el.editBoard.addEventListener('click', () => {
  if (!editingBoard && running) stop();
  editingBoard = !editingBoard;
  draggedObject = null;
  updateControls();
});
el.objectPalette.addEventListener('click', (event) => {
  const toolButton = event.target instanceof Element ? event.target.closest('[data-object-tool]') : null;
  if (toolButton) selectObjectTool(toolButton.dataset.objectTool);
});
el.objectPalette.addEventListener('dragstart', (event) => {
  const toolButton = event.target instanceof Element ? event.target.closest('[data-object-tool]') : null;
  const tool = toolButton?.dataset.objectTool;
  if (!tool || tool === 'erase' || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData('text/plain', tool);
  event.dataTransfer.effectAllowed = 'copy';
});
el.canvas.addEventListener('dragover', (event) => {
  if (!editingBoard || !event.dataTransfer?.types.includes('text/plain')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
el.canvas.addEventListener('drop', (event) => {
  if (!editingBoard) return;
  const tool = event.dataTransfer?.getData('text/plain');
  if (!tool || tool === 'erase' || !(tool in OBJECT_COLLECTIONS || tool === 'sheep')) return;
  event.preventDefault();
  const cell = boardCell(event);
  if (cell && placeObject(tool, cell)) {
    saveBoardLayout();
    updateStatus();
  }
});
el.canvas.addEventListener('pointerdown', (event) => {
  if (!editingBoard) return;
  const cell = boardCell(event);
  if (!cell) return;
  if (selectedObjectTool === 'erase') {
    removeObjectAt(cell);
  } else {
    const found = objectAt(cell);
    if (found) {
      draggedObject = found;
      el.canvas.classList.add('dragging');
      el.canvas.setPointerCapture(event.pointerId);
    } else if (selectedObjectTool === 'sheep') {
      placeObject('sheep', cell);
    } else {
      placeObject(selectedObjectTool, cell);
    }
  }
  saveBoardLayout();
  updateStatus();
  event.preventDefault();
});
el.canvas.addEventListener('pointermove', (event) => {
  if (!editingBoard) return;
  const cell = boardCell(event);
  if (!draggedObject) {
    el.canvas.classList.toggle('can-drag', Boolean(cell && objectAt(cell)));
  } else {
    if (cell) moveObject(draggedObject, cell);
    updateStatus();
  }
});
el.canvas.addEventListener('pointerup', (event) => {
  const wasDragging = Boolean(draggedObject);
  if (draggedObject && !boardCell(event)) {
    removeObject(draggedObject);
    updateStatus();
  }
  draggedObject = null;
  if (wasDragging) saveBoardLayout();
  el.canvas.classList.remove('dragging');
  const cell = boardCell(event);
  el.canvas.classList.toggle('can-drag', Boolean(editingBoard && cell && objectAt(cell)));
});
el.canvas.addEventListener('pointercancel', () => {
  if (draggedObject) saveBoardLayout();
  draggedObject = null;
  el.canvas.classList.remove('dragging', 'can-drag');
});
el.generate.addEventListener('click', generate);
el.prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
});
el.draftSave.addEventListener('click', saveDraft);
const draftFormatStatus = document.createElement('span');
draftFormatStatus.className = 'muted format-status';
el.draftSave.before(button('Format JS', () => formatCode(el.draftCode, draftFormatStatus)));
el.draftSave.after(draftFormatStatus);
el.draftDiscard.addEventListener('click', discardFunctionDraft);
el.draftDelete.addEventListener('click', deleteEditingFunction);
resetWorld(false);
selectObjectTool(selectedObjectTool);
renderLibrary();
el.addFunction.disabled = true;
updateControls();
loadUserLibrary()
  .then(() => {
    libraryReady = true;
    el.addFunction.disabled = false;
    updateControls();
  })
  .catch((err) => addLog(`Library load failed: ${err.message}`, 'error'));

(function loop(t) {
  renderer.frame(state, t);
  requestAnimationFrame(loop);
})(performance.now());
