'use strict';

//const apex = window.parent.apex;
const status = document.getElementById('saga-status');
const map = document.getElementById('saga-map');
const levelCount = document.getElementById('level-count');

function showError(message) {
  status.textContent = message;
  status.classList.add('error');
}

function renderLevels(levels) {
  levelCount.textContent = `${levels.length} ${levels.length === 1 ? 'level' : 'levels'}`;
  if (levels.length === 0) {
    status.textContent = '';
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No levels have been added yet.';
    map.replaceChildren(empty);
    return;
  }

  status.textContent = 'Select a level to begin.';
  map.replaceChildren(...levels.map((level, index) => {
    const item = document.createElement('li');
    item.className = 'level-item';

    const button = document.createElement('button');
    button.className = 'level-button';
    button.type = 'button';
    button.setAttribute('aria-label', `Play level ${level.stageNumber}: ${level.name}`);

    const number = document.createElement('span');
    number.className = 'level-number';
    number.textContent = String(index + 1);
    number.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'level-copy';
    const title = document.createElement('span');
    title.className = 'level-title';
    title.textContent = level.name;
    copy.append(title);
    if (level.description) {
      const description = document.createElement('span');
      description.className = 'level-description';
      description.textContent = level.description;
      copy.append(description);
    }
    if (level.finished) {
      const score = level.score == null ? 0 : Number(level.score);
      const stars = document.createElement('span');
      stars.className = 'level-stars';
      stars.textContent = `${'★'.repeat(score)}${'☆'.repeat(3 - score)}`;
      stars.setAttribute('aria-label', `${score} of 3 stars`);
      copy.append(stars);
    }

    const play = document.createElement('span');
    play.className = 'level-play';
    play.textContent = '›';
    play.setAttribute('aria-hidden', 'true');

    button.append(number, copy, play);
    button.addEventListener('click', () => openLevel(level.url));
    item.append(button);
    return item;
  }));
}

function openLevel(url) {
  const destination = new URL(url, window.location.href);
  if (!['http:', 'https:'].includes(destination.protocol)) {
    showError('The level query returned an invalid URL.');
    return;
  }
  apex.navigation.redirect(destination.href);
}

async function loadLevels() {
  try {
    const response = await apex.server.process('LOAD_STAGES', {}, { dataType: 'text' });
    const levels = JSON.parse(response);
    if (!Array.isArray(levels) || levels.some((level) => (
      !level
      || !Number.isInteger(Number(level.stageNumber))
      || typeof level.name !== 'string'
      || typeof level.url !== 'string'
      || !level.url.trim()
      || (level.description != null && typeof level.description !== 'string')
      || typeof level.finished !== 'boolean'
      || (level.score != null && (!Number.isInteger(Number(level.score)) || Number(level.score) < 0 || Number(level.score) > 3))
    ))) {
      throw new Error('The server returned an invalid level list.');
    }
    renderLevels(levels.map((level) => ({
      ...level,
      stageNumber: Number(level.stageNumber),
      description: level.description || '',
      score: level.score == null ? null : Number(level.score),
    })));
  } catch (error) {
    showError(`Could not load levels: ${error.message}`);
  }
}

loadLevels();
