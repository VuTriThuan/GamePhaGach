import { CONFIG } from './config.ts';
import type { Brick } from './model.ts';
import { Random } from './random.ts';

const firstX = 59;
const cell = CONFIG.brickWidth + CONFIG.brickGapX;
const laneCount = 6;

export class LevelBuilder {
  private nextId = 1;

  constructor(private readonly rng: Random) {}

  opening(): Brick[] {
    return [{ ...this.make(this.rng.int(0, laneCount - 1), 745, 1), starter: true }];
  }

  newRow(turn: number, existing: Brick[]): Brick[] {
    const count = Math.min(CONFIG.maxBricksPerRow,
      1 + Math.floor((turn - 1) / CONFIG.turnsPerExtraBrick));
    const row: Brick[] = [];
    for (let i = 0; i < count; i++) {
      const blocked = [...existing, ...row]
        .filter((brick) => brick.y < CONFIG.topRowY + CONFIG.brickHeight &&
          brick.y + brick.h > CONFIG.topRowY)
        .map((brick) => Math.round((brick.x - firstX) / cell));
      const options = Array.from({ length: laneCount }, (_, col) => col)
        .filter((col) => !blocked.includes(col));
      if (!options.length) break;
      const brick = this.make(options[this.rng.int(0, options.length - 1)], CONFIG.topRowY, turn);
      if (count > 1) brick.armor = count;
      row.push(brick);
    }
    return row;
  }

  private make(col: number, y: number, hp: number): Brick {
    return {
      id: this.nextId++, x: firstX + col * cell, y,
      w: CONFIG.brickWidth, h: CONFIG.brickHeight,
      hp, initialHp: hp, hue: 183 + this.rng.int(0, 105),
    };
  }
}
