import { CONFIG } from './config.ts';
import type { Ball, Brick, Spark } from './model.ts';

export interface PhysicsResult {
  collected: boolean;
  damage: number;
}

export function moveBall(ball: Ball, bricks: Brick[], sparks: Spark[], dt: number): PhysicsResult {
  ball.age += dt;
  const oldX = ball.x;
  const oldY = ball.y;
  ball.previousX = oldX;
  ball.previousY = oldY;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  const r = CONFIG.ballRadius;

  if (ball.x <= CONFIG.left + r) {
    ball.x = CONFIG.left + r;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x >= CONFIG.right - r) {
    ball.x = CONFIG.right - r;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y <= CONFIG.ceiling + r) {
    ball.y = CONFIG.ceiling + r;
    ball.vy = Math.abs(ball.vy);
  }

  // The launcher sits below the loss line. Collect only when the ball returns
  // from the playfield and its leading edge touches that line from above.
  if (ball.vy > 0 && oldY + r < CONFIG.lossY && ball.y + r >= CONFIG.lossY) {
    ball.y = CONFIG.lossY - r;
    return { collected: true, damage: 0 };
  }

  for (const brick of bricks) {
    if (brick.hp <= 0) continue;
    const cx = Math.max(brick.x, Math.min(ball.x, brick.x + brick.w));
    const cy = Math.max(brick.y, Math.min(ball.y, brick.y + brick.h));
    const ox = ball.x - cx;
    const oy = ball.y - cy;
    if (ox * ox + oy * oy > r * r) continue;

    // Sweep direction chooses the face that the ball entered. Separate the
    // ball immediately and keep a short per-brick cooldown as a safety net.
    if (oldY + r <= brick.y && ball.vy > 0) {
      ball.y = brick.y - r - 0.1;
      ball.vy = -Math.abs(ball.vy);
    } else if (oldY - r >= brick.y + brick.h && ball.vy < 0) {
      ball.y = brick.y + brick.h + r + 0.1;
      ball.vy = Math.abs(ball.vy);
    } else if (oldX + r <= brick.x && ball.vx > 0) {
      ball.x = brick.x - r - 0.1;
      ball.vx = -Math.abs(ball.vx);
    } else if (oldX - r >= brick.x + brick.w && ball.vx < 0) {
      ball.x = brick.x + brick.w + r + 0.1;
      ball.vx = Math.abs(ball.vx);
    } else {
      const left = Math.abs(ball.x - (brick.x - r));
      const right = Math.abs(ball.x - (brick.x + brick.w + r));
      const top = Math.abs(ball.y - (brick.y - r));
      const bottom = Math.abs(ball.y - (brick.y + brick.h + r));
      const nearest = Math.min(left, right, top, bottom);
      if (nearest === left) { ball.x = brick.x - r - 0.1; ball.vx = -Math.abs(ball.vx); }
      else if (nearest === right) { ball.x = brick.x + brick.w + r + 0.1; ball.vx = Math.abs(ball.vx); }
      else if (nearest === top) { ball.y = brick.y - r - 0.1; ball.vy = -Math.abs(ball.vy); }
      else { ball.y = brick.y + brick.h + r + 0.1; ball.vy = Math.abs(ball.vy); }
    }

    if (ball.lastBrickId === brick.id && ball.age - ball.lastBrickAt < 0.045) {
      return { collected: false, damage: 0 };
    }
    ball.lastBrickId = brick.id;
    ball.lastBrickAt = ball.age;
    brick.impacts = (brick.impacts ?? 0) + 1;
    if (brick.armor && brick.impacts % brick.armor !== 0) {
      return { collected: false, damage: 0 };
    }
    brick.hp -= 1;
    if (brick.hp <= 0) {
      for (let i = 0; i < 9; i++) sparks.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, life: 0.45 + i * 0.025, hue: brick.hue });
    } else if ((brick.id + Math.floor(ball.age * 120)) % 6 === 0) {
      sparks.push({ x: cx, y: cy, life: 0.25, hue: brick.hue });
    }
    return { collected: false, damage: 1 };
  }
  return { collected: false, damage: 0 };
}
