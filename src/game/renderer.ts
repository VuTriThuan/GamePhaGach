import { CONFIG } from './config.ts';
import { Game } from './game.ts';
import type { Brick } from './model.ts';

const W = CONFIG.width;
const H = CONFIG.height;
let background: HTMLCanvasElement | null = null;

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function label(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left', weight = 700): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

function drawBrick(ctx: CanvasRenderingContext2D, brick: Brick, y: number, highlighted: boolean): void {
  const { x, w, h } = brick;
  const hue = brick.starter ? 45 : brick.armor ? 36 : brick.hue;
  const flash = Math.min(1, (brick.hitFlash ?? 0) / 0.18);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(1 + flash * 0.045, 1 + flash * 0.045);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = highlighted || brick.starter ? '#ffcc5a' : `hsla(${hue}, 95%, 64%, .5)`;
  ctx.shadowBlur = highlighted ? 34 : 17 + flash * 15;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = `hsl(${hue}, 75%, 34%)`;
  rounded(ctx, 0, 0, w, h, 15);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const face = ctx.createLinearGradient(0, 3, w, h);
  face.addColorStop(0, `hsl(${hue}, 98%, ${75 + flash * 10}%)`);
  face.addColorStop(1, `hsl(${hue}, 88%, 52%)`);
  ctx.fillStyle = face;
  rounded(ctx, 4, 3, w - 8, h - 12, 11);
  ctx.fill();
  ctx.fillStyle = '#ffffff69';
  rounded(ctx, 12, 9, w - 24, 4, 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff25';
  rounded(ctx, 12, h - 15, w - 24, 3, 2);
  ctx.fill();
  label(ctx, String(brick.hp), w / 2, h / 2 + 1, brick.hp >= 100 ? 26 : 31, '#102441', 'center', 900);
  if (brick.armor) label(ctx, `GIÁP ×${brick.armor}`, w / 2, 14, 10, '#503516', 'center', 900);
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#171c43');
  bg.addColorStop(0.52, '#101832');
  bg.addColorStop(1, '#0a2238');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(555, 355, 20, 555, 355, 580);
  glow.addColorStop(0, '#3864a629');
  glow.addColorStop(1, '#3864a600');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  rounded(ctx, 26, 215, 668, 912, 29);
  ctx.fillStyle = '#09142b9c';
  ctx.fill();
  ctx.strokeStyle = '#75b8db2a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  rounded(ctx, 27, 216, 666, 910, 28);
  ctx.clip();
  for (let row = 0; row < 16; row++) {
    const y = 255 + row * 55;
    ctx.strokeStyle = row % 4 === 0 ? '#8bb7dc19' : '#8bb7dc0c';
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(684, y);
    ctx.stroke();
    for (let col = 0; col < 8; col++) {
      const x = 71 + col * 82 + (row % 2) * 22;
      ctx.fillStyle = `rgba(134, 225, 246, ${0.10 + 0.035 * Math.sin(time * 1.6 + row + col)})`;
      ctx.beginPath();
      ctx.arc(x, y + 27, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.strokeStyle = '#63d6e166';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CONFIG.left, 240);
  ctx.lineTo(CONFIG.left, CONFIG.lossY);
  ctx.moveTo(CONFIG.right, 240);
  ctx.lineTo(CONFIG.right, CONFIG.lossY);
  ctx.stroke();
}

export function render(ctx: CanvasRenderingContext2D, game: Game, time: number, alpha = 1): void {
  if (!background) {
    background = document.createElement('canvas');
    background.width = W;
    background.height = H;
    const backgroundContext = background.getContext('2d', { alpha: false });
    if (backgroundContext) drawBackground(backgroundContext, 0);
  }
  ctx.drawImage(background, 0, 0);

  rounded(ctx, 30, 25, 660, 139, 27);
  ctx.fillStyle = '#ffffff0e';
  ctx.fill();
  ctx.strokeStyle = '#ffffff20';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  label(ctx, 'PHÁ GẠCH', 55, 62, 40, '#ffffff', 'left', 900);
  label(ctx, `VÁN ${String(game.gameIndex).padStart(2, '0')}`, 657, 58, 22, '#f3f1ff', 'right', 850);
  label(ctx, `LƯỢT ${String(game.turn).padStart(2, '0')}`, 657, 105, 22, '#b4c8e7', 'right', 800);

  rounded(ctx, 45, 177, 630, 32, 16);
  ctx.fillStyle = '#28446c';
  ctx.fill();
  label(ctx, `✦  ${game.score.toLocaleString('vi-VN')} ĐIỂM`, 63, 193, 17, '#fff1aa', 'left', 850);
  label(ctx, `●  ${game.ballCount} BÓNG`, 656, 193, 17, '#a7fff0', 'right', 850);

  const opening = game.turn === 1 && game.bricks.some((brick) => brick.starter);
  if (opening && game.phase !== 'GAME_OVER') {
    rounded(ctx, 205, 236, 310, 43, 21);
    ctx.fillStyle = '#ffe6a71e';
    ctx.fill();
    label(ctx, 'BẮT ĐẦU TỪ GẠCH 1', 360, 258, 17, '#ffe7a1', 'center', 850);
  }

  if (game.phase === 'AIMING') {
    const dx = Math.cos(game.angle);
    const dy = Math.sin(game.angle);
    ctx.save();
    ctx.setLineDash([8, 11]);
    ctx.lineDashOffset = -time * 34;
    ctx.strokeStyle = '#a3fff0c9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(game.launchX, CONFIG.launchY);
    ctx.lineTo(game.launchX + dx * 252, CONFIG.launchY + dy * 252);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  rounded(ctx, 27, 216, 666, 910, 28);
  ctx.clip();
  const rowOffset = game.rowTransition > 0 ? -game.rowTransitionStep * Math.pow(game.rowTransition / 0.24, 3) : 0;
  const lossBrickId = game.loss?.losingBrickId;
  for (const brick of game.bricks) drawBrick(ctx, brick, brick.y + rowOffset, game.phase === 'GAME_OVER' && brick.id === lossBrickId);

  for (const spark of game.sparks) {
    const spread = (0.7 - spark.life) * 35;
    const x = spark.x + Math.sin(spark.hue + spark.life * 23) * spread;
    const y = spark.y - spread;
    ctx.fillStyle = `hsla(${spark.hue}, 100%, 77%, ${Math.min(1, spark.life * 2)})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.5 + spark.life * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const ball of game.balls) {
    const x = (ball.previousX ?? ball.x) + (ball.x - (ball.previousX ?? ball.x)) * alpha;
    const y = (ball.previousY ?? ball.y) + (ball.y - (ball.previousY ?? ball.y)) * alpha;
    const tailX = x - ball.vx / CONFIG.ballSpeed * 20;
    const tailY = y - ball.vy / CONFIG.ballSpeed * 20;
    const trail = ctx.createLinearGradient(tailX, tailY, x, y);
    trail.addColorStop(0, '#95fff000');
    trail.addColorStop(1, '#a6fff0b8');
    ctx.strokeStyle = trail;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#fffef0';
    ctx.shadowColor = '#9dfbf5';
    ctx.shadowBlur = 13;
    ctx.beginPath();
    ctx.arc(x, y, CONFIG.ballRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  ctx.strokeStyle = '#ff778b';
  ctx.shadowColor = '#ff6e92';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(45, CONFIG.lossY);
  ctx.lineTo(675, CONFIG.lossY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  label(ctx, 'VẠCH THUA', 360, CONFIG.lossY + 27, 16, '#ffaabd', 'center', 850);

  ctx.fillStyle = '#75fff0';
  ctx.shadowColor = '#6dffeb';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(game.launchX, CONFIG.launchY, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#183d58';
  ctx.beginPath();
  ctx.arc(game.launchX, CONFIG.launchY, 5, 0, Math.PI * 2);
  ctx.fill();

  if (game.phase === 'GAME_OVER') {
    rounded(ctx, 104, 349, 512, 203, 31);
    ctx.fillStyle = '#07152de6';
    ctx.fill();
    ctx.strokeStyle = '#ffd27d91';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, 'GAME OVER', 360, 401, 48, '#ffe6a6', 'center', 900);
    label(ctx, `GẠCH ${game.loss?.losingBrickValue}: CÒN ${game.loss?.losingBrickHp} HP`, 360, 467, 28, '#ffffff', 'center', 900);
    label(ctx, 'VÁN MỚI SẮP BẮT ĐẦU', 360, 518, 18, '#a4ffee', 'center', 800);
  }
}
