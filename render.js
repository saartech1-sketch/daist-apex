const CELL = 48;

function canSeeCell(x, y, sheep, width, height, visibilityRange, stoneSet) {
  if (
    x < 0 || y < 0 || x >= width || y >= height
    || Math.hypot(x - sheep.x, y - sheep.y) >= visibilityRange
  ) return false;

  let lineX = sheep.x;
  let lineY = sheep.y;
  const dx = Math.abs(x - lineX);
  const sx = lineX < x ? 1 : -1;
  const dy = -Math.abs(y - lineY);
  const sy = lineY < y ? 1 : -1;
  let error = dx + dy;

  while (lineX !== x || lineY !== y) {
    if ((lineX !== sheep.x || lineY !== sheep.y) && stoneSet.has(`${lineX},${lineY}`)) {
      return false;
    }
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
}

function drawGrass(ctx, w, h, texturePattern = null) {
  if (texturePattern) {
    ctx.fillStyle = texturePattern;
    ctx.fillRect(0, 0, w * CELL, h * CELL);
    return;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#8cc265' : '#97cc6f';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function drawStone(ctx, x, y) {
  const px = x * CELL;
  const py = y * CELL;
  ctx.fillStyle = '#7a6a55';
  ctx.fillRect(px, py, CELL, CELL);
  ctx.fillStyle = '#8f8070';
  ctx.beginPath();
  ctx.roundRect(px + 3, py + 3, CELL - 6, CELL - 6, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.roundRect(px + 7, py + 6, CELL / 2, CELL / 4, 5);
  ctx.fill();
}

function drawFence(ctx, x, y, woodImage = null) {
  const px = x * CELL;
  const py = y * CELL;
  if (woodImage) {
    ctx.drawImage(woodImage, px, py, CELL, CELL);
    return;
  }
  ctx.fillStyle = '#795936';
  for (const offset of [11, 32]) ctx.fillRect(px + 3, py + offset, CELL - 6, 5);
  ctx.fillStyle = '#a87942';
  for (const offset of [8, 28]) ctx.fillRect(px + offset, py + 3, 5, CELL - 6);
}

function drawWolf(ctx, x, y) {
  const cx = x * CELL + CELL / 2;
  const cy = y * CELL + CELL / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(25, 32, 25, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 17, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#493b3c';
  for (const lx of [-11, -3, 7, 14]) {
    ctx.fillRect(lx, 5, 3, 10);
  }

  ctx.fillStyle = '#594650';
  ctx.beginPath();
  ctx.ellipse(0, 1, 16, 9, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-13, -2);
  ctx.lineTo(-21, -7);
  ctx.lineTo(-18, 2);
  ctx.lineTo(-11, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#493b3c';
  ctx.beginPath();
  ctx.moveTo(5, -6);
  ctx.lineTo(7, -19);
  ctx.lineTo(14, -10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(13, -8);
  ctx.lineTo(22, -14);
  ctx.lineTo(20, -4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#594650';
  ctx.beginPath();
  ctx.ellipse(11, -2, 9, 7, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, -2);
  ctx.lineTo(23, 1);
  ctx.lineTo(15, 5);
  ctx.lineTo(9, 3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#c5b5a4';
  ctx.beginPath();
  ctx.ellipse(17, 2, 6, 3, 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#30292b';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(11, 5);
  ctx.lineTo(19, 6);
  ctx.stroke();

  ctx.fillStyle = '#211d20';
  ctx.beginPath();
  ctx.arc(22, 1, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2cc69';
  ctx.beginPath();
  ctx.ellipse(14, -4, 2.2, 1.7, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#211d20';
  ctx.beginPath();
  ctx.arc(14.5, -4, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGrassTuft(ctx, x, y, t, weedImage = null) {
  const cx = x * CELL + CELL / 2;
  const cy = y * CELL + CELL / 2;
  if (weedImage) {
    ctx.drawImage(weedImage, x * CELL, y * CELL, CELL, CELL);
    return;
  }
  const sway = Math.sin(t / 500 + x + y) * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(48, 103, 39, 0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 7, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const blades = [
    [-8, -7, -10, '#4e8f3c'],
    [-5, -13, -5, '#6cae4c'],
    [-2, -17, 1, '#538f3b'],
    [2, -15, 7, '#75b84e'],
    [5, -11, 12, '#4d8737'],
    [0, -12, -12, '#83c45b'],
    [1, -18, 12, '#609f43'],
  ];
  for (const [startX, tipY, curveX, color] of blades) {
    const tipX = startX + curveX * 0.55 + sway * (tipY / -18);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(startX, 7);
    ctx.quadraticCurveTo(startX + curveX, tipY + 6, tipX, tipY);
    ctx.quadraticCurveTo(tipX - curveX * 0.25, tipY + 8, startX, 7);
    ctx.fill();
  }
  ctx.restore();
}

function drawWater(ctx, x, y, t, waterImage = null) {
  if (waterImage) {
    ctx.drawImage(waterImage, x * CELL, y * CELL, CELL, CELL);
    return;
  }
  const cx = x * CELL + CELL / 2;
  const cy = y * CELL + CELL / 2;
  const ripple = Math.sin(t / 350 + x + y) * 1.5;
  ctx.fillStyle = '#397fa0';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 17, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224, 248, 255, 0.9)';
  ctx.lineWidth = 2;
  for (const offset of [-5, 3]) {
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy + offset, 8 + ripple, 2.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSheep(ctx, cx, cy, facing, bob) {
  const s = CELL / 48;
  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.scale(facing * s, s);

  ctx.fillStyle = '#333';
  for (const lx of [-11, -4, 5, 12]) ctx.fillRect(lx - 2, 6, 4, 12);

  ctx.fillStyle = '#fafafa';
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1.5;
  for (const [bx, by, r] of [[-10, 0, 9], [0, -5, 10], [10, 0, 9], [-4, 5, 9], [6, 5, 9], [0, 0, 11]]) {
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.ellipse(17, -4, 7, 9, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(12, -10, 4, 2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(19, -6, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawObjectIcon(canvas, type, weedImage = null, waterImage = null, woodImage = null) {
  const ctx = canvas.getContext('2d');
  drawGrass(ctx, 1, 1);

  if (type === 'sheep') drawSheep(ctx, CELL / 2, CELL / 2, 1, 0);
  else if (type === 'erase') {
    ctx.fillStyle = '#c65b5b';
    ctx.beginPath();
    ctx.moveTo(13, 9);
    ctx.lineTo(20, 9);
    ctx.lineTo(36, 25);
    ctx.lineTo(25, 36);
    ctx.lineTo(9, 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 17);
    ctx.lineTo(24, 26);
    ctx.stroke();
  } else if (type === 'wolf') drawWolf(ctx, 0, 0);
  else if (type === 'stone') drawStone(ctx, 0, 0);
  else if (type === 'fence') drawFence(ctx, 0, 0, woodImage);
  else if (type === 'grass') drawGrassTuft(ctx, 0, 0, 0, weedImage);
  else if (type === 'water') drawWater(ctx, 0, 0, 0, waterImage);
}

class Renderer {
  constructor(
    canvas,
    visibilityRange,
    grassTextureUrl,
    weedImageUrl,
    waterImageUrl,
    woodImageUrl,
    onGrassTextureError,
    onWeedImageLoad,
    onWaterImageLoad,
    onWoodImageLoad,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visibilityRange = visibilityRange;
    this.visionVisible = false;
    this.grassTexturePattern = null;
    this.weedImage = null;
    this.waterImage = null;
    this.woodImage = null;
    this.draw = { x: 0, y: 0 };
    this.facing = 1;
    this.bumpUntil = 0;

    const grassTexture = new Image();
    grassTexture.onload = () => {
      const tile = document.createElement('canvas');
      tile.width = CELL;
      tile.height = CELL;
      tile.getContext('2d').drawImage(grassTexture, 0, 0, CELL, CELL);
      this.grassTexturePattern = this.ctx.createPattern(tile, 'repeat');
    };
    grassTexture.onerror = () => {
      onGrassTextureError(new Error(`Unable to load grass texture: ${grassTextureUrl}`));
    };
    grassTexture.src = grassTextureUrl;

    const weedImage = new Image();
    weedImage.onload = () => {
      this.weedImage = weedImage;
      onWeedImageLoad(weedImage);
    };
    weedImage.onerror = () => {
      onGrassTextureError(new Error(`Unable to load weed image: ${weedImageUrl}`));
    };
    weedImage.src = weedImageUrl;

    const waterImage = new Image();
    waterImage.onload = () => {
      this.waterImage = waterImage;
      onWaterImageLoad(waterImage);
    };
    waterImage.onerror = () => {
      onGrassTextureError(new Error(`Unable to load water image: ${waterImageUrl}`));
    };
    waterImage.src = waterImageUrl;

    const woodImage = new Image();
    woodImage.onload = () => {
      this.woodImage = woodImage;
      onWoodImageLoad(woodImage);
    };
    woodImage.onerror = () => {
      onGrassTextureError(new Error(`Unable to load wood image: ${woodImageUrl}`));
    };
    woodImage.src = woodImageUrl;
  }

  setVisionVisible(visible) {
    this.visionVisible = visible;
  }

  resize(width, height) {
    this.canvas.width = width * CELL;
    this.canvas.height = height * CELL;
  }

  snapTo(pos) {
    this.draw = { ...pos };
  }

  bump() {
    this.bumpUntil = performance.now() + 250;
  }

  setFacing(action) {
    if (action === 'left') this.facing = -1;
    else if (action === 'right') this.facing = 1;
  }

  frame(state, t) {
    const { ctx } = this;
    const k = 0.25;
    this.draw.x += (state.sheep.x - this.draw.x) * k;
    this.draw.y += (state.sheep.y - this.draw.y) * k;

    drawGrass(ctx, state.width, state.height, this.grassTexturePattern);
    for (const s of state.stones) drawStone(ctx, s.x, s.y);
    for (const f of state.fences) drawFence(ctx, f.x, f.y, this.woodImage);
    for (const g of state.grass) drawGrassTuft(ctx, g.x, g.y, t, this.weedImage);
    for (const w of state.water) drawWater(ctx, w.x, w.y, t, this.waterImage);
    for (const w of state.wolves) drawWolf(ctx, w.x, w.y);

    if (this.visionVisible) {
      const stones = new Set(state.stones.map((stone) => `${stone.x},${stone.y}`));
      ctx.save();
      ctx.beginPath();
      for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
          if (canSeeCell(x, y, state.sheep, state.width, state.height, this.visibilityRange, stones)) {
            ctx.rect(x * CELL, y * CELL, CELL, CELL);
          }
        }
      }
      ctx.clip();
      ctx.fillStyle = 'rgba(222, 243, 255, 0.18)';
      ctx.beginPath();
      ctx.arc(
        this.draw.x * CELL + CELL / 2,
        this.draw.y * CELL + CELL / 2,
        this.visibilityRange * CELL,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    const moving = Math.abs(state.sheep.x - this.draw.x) + Math.abs(state.sheep.y - this.draw.y) > 0.02;
    const bob = moving ? Math.sin(t / 40) * 2 : 0;
    const shake = t < this.bumpUntil ? Math.sin(t / 15) * 3 : 0;
    drawSheep(ctx, this.draw.x * CELL + CELL / 2 + shake, this.draw.y * CELL + CELL / 2, this.facing, bob);
  }
}
