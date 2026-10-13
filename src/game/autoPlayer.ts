import { CONFIG } from './config.ts';
import type { Ball, Brick } from './model.ts';
import { moveBall } from './physics.ts';
import { Random } from './random.ts';

// Preview the same collisions used by the game. A path earns most of its
// score when one ball reaches several different bricks in succession.
function previewAngle(originX: number, angle: number, bricks: Brick[]): number {
  const previewBricks = bricks.map((brick) => ({ ...brick }));
  const unique = new Set<number>();
  let score = 0;
  const steps = Math.ceil(CONFIG.previewSeconds / CONFIG.fixedStep);

  for (let shot = 0; shot < CONFIG.startingBalls; shot++) {
    const ball: Ball = {
      x: originX, y: CONFIG.launchY,
      vx: Math.cos(angle) * CONFIG.ballSpeed,
      vy: Math.sin(angle) * CONFIG.ballSpeed,
      age: 0, lastBrickId: -1, lastBrickAt: -1,
    };
    let previousHit = -1;
    for (let step = 0; step < steps; step++) {
      const result = moveBall(ball, previewBricks, [], CONFIG.fixedStep);
      if (result.collected) break;
      if (!result.damage) continue;
      const brick = bricks.find((item) => item.id === ball.lastBrickId);
      if (!brick) continue;
      const urgency = 1 + brick.y / CONFIG.lossY;
      // Leave a lone low-value brick standing when possible so the next
      // turn has two surfaces to ricochet between.
      const contactValue = unique.has(brick.id) ? (unique.size === 1 ? -1.5 : 0.24) : 2.6;
      score += urgency * contactValue;
      if (previousHit !== -1 && previousHit !== brick.id) score += 2.4;
      unique.add(brick.id);
      previousHit = brick.id;
    }
  }

  return score + unique.size * unique.size * 1.5;
}

export class AngleSearch {
  bestAngle = -Math.PI / 2;
  done = false;
  private best = -Infinity;
  private index = 0;

  constructor(private readonly originX: number, private readonly bricks: Brick[], private readonly rng: Random) {}

  step(count: number): void {
    for (let n = 0; n < count && !this.done; n++) {
      const i = this.index++;
      const angle = -Math.PI + 0.25 + i * ((Math.PI - 0.5) / 50);
      if (Math.abs(Math.cos(angle)) >= 0.16) {
        const score = previewAngle(this.originX, angle, this.bricks) + this.rng.next() * 0.03;
        if (score > this.best) {
          this.best = score;
          this.bestAngle = angle;
        }
      }
      if (this.index > 50) this.done = true;
    }
  }
}

export function chooseAngle(originX: number, bricks: Brick[], rng: Random): number {
  const search = new AngleSearch(originX, bricks, rng);
  search.step(51);
  return search.bestAngle;
}

export function aimAtStarter(originX: number, bricks: Brick[], rng: Random): number {
  const starter = bricks.find((brick) => brick.starter && brick.hp > 0);
  if (!starter) return chooseAngle(originX, bricks, rng);
  return Math.atan2(starter.y + starter.h / 2 - CONFIG.launchY, starter.x + starter.w / 2 - originX);
}
