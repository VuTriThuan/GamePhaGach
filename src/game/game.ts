import { aimAtStarter, AngleSearch } from './autoPlayer.ts';
import { CONFIG } from './config.ts';
import { LevelBuilder } from './levels.ts';
import type { Ball, Brick, GamePhase, LossRecord, Spark } from './model.ts';
import { moveBall } from './physics.ts';
import { Random } from './random.ts';

export function ballCountForScore(score: number): number {
  let count = CONFIG.startingBalls;
  let threshold = CONFIG.firstBonusBallScore;
  while (score >= threshold) {
    count++;
    threshold *= CONFIG.bonusBallScoreMultiplier;
  }
  return count;
}

export class Game {
  gameIndex = 1;
  turn = 1;
  score = 0;
  ballCount: number = CONFIG.startingBalls;
  phase: GamePhase = 'AIMING';
  phaseTime = 0;
  shotTime = 0;
  launchX = CONFIG.width / 2;
  firstLandingX: number | null = null;
  angle = -Math.PI / 2;
  balls: Ball[] = [];
  bricks: Brick[] = [];
  sparks: Spark[] = [];
  fired = 0;
  loss: LossRecord | null = null;
  lossHistory: LossRecord[] = [];
  rowTransition = 0;
  rowTransitionStep: number = CONFIG.rowStep;
  private rng: Random;
  private levels: LevelBuilder;
  private angleSearch: AngleSearch | null = null;

  constructor(seed = CONFIG.seed, private readonly onLoss?: (record: LossRecord) => void) {
    this.rng = new Random(seed);
    this.levels = new LevelBuilder(this.rng);
    this.bricks = this.levels.opening();
    this.angle = aimAtStarter(this.launchX, this.bricks, this.rng);
  }

  update(dt = CONFIG.fixedStep): void {
    this.phaseTime += dt;
    this.sparks = this.sparks.filter((spark) => (spark.life -= dt) > 0);
    this.rowTransition = Math.max(0, this.rowTransition - dt);
    for (const brick of this.bricks) brick.hitFlash = Math.max(0, (brick.hitFlash ?? 0) - dt);

    if (this.phase === 'GAME_OVER') {
      if (this.phaseTime >= CONFIG.gameOverSeconds) this.restart();
      return;
    }
    if (this.phase === 'AIMING') {
      if (this.angleSearch) {
        this.angleSearch.step(1);
        this.angle = this.angleSearch.bestAngle;
        if (this.angleSearch.done) this.angleSearch = null;
      }
      if (this.phaseTime + 1e-9 >= (this.turn === 1 ? CONFIG.aimSeconds : CONFIG.turnDelaySeconds)) {
        if (this.angleSearch) return;
        this.phase = 'FIRING';
        this.phaseTime = 0;
        this.shotTime = 0;
        this.fired = 0;
        this.firstLandingX = null;
      }
      return;
    }
    if (this.phase === 'ADVANCING') {
      this.advance();
      return;
    }

    this.shotTime += dt;
    if (this.phase === 'FIRING') {
      while (this.fired < this.ballCount && this.phaseTime >= this.fired * CONFIG.fireInterval) {
        this.balls.push({
          x: this.launchX, y: CONFIG.launchY,
          previousX: this.launchX, previousY: CONFIG.launchY,
          vx: Math.cos(this.angle) * CONFIG.ballSpeed,
          vy: Math.sin(this.angle) * CONFIG.ballSpeed,
          age: 0, lastBrickId: -1, lastBrickAt: -1,
        });
        this.fired++;
      }
      if (this.fired === this.ballCount) {
        this.phase = 'RESOLVING';
        this.phaseTime = 0;
      }
    }

    const remaining: Ball[] = [];
    for (const ball of this.balls) {
      const result = moveBall(ball, this.bricks, this.sparks, dt);
      if (result.damage) {
        const struck = this.bricks.find((brick) => brick.id === ball.lastBrickId);
        if (struck) struck.hitFlash = 0.18;
      }
      this.score += result.damage;
      this.ballCount = ballCountForScore(this.score);
      if (result.collected) {
        if (this.firstLandingX === null) this.firstLandingX = ball.x;
      } else remaining.push(ball);
    }
    this.balls = remaining;
    this.bricks = this.bricks.filter((brick) => brick.hp > 0);
    if (this.phase === 'RESOLVING' && this.balls.length === 0) {
      this.phase = 'ADVANCING';
      this.phaseTime = 0;
    }
  }

  private advance(): void {
    if (this.firstLandingX !== null) {
      this.launchX = Math.max(CONFIG.left + 24, Math.min(CONFIG.right - 24, this.firstLandingX));
    }
    const rowStep = CONFIG.rowStep;
    this.rowTransitionStep = rowStep;
    for (const brick of this.bricks) brick.y += rowStep;
    const crossing = this.bricks.filter((brick) => brick.y + brick.h >= CONFIG.lossY);
    if (crossing.length) {
      // Any crossing brick causes a real loss. Show the strongest one when
      // several cross together, then use position and ID to break ties.
      crossing.sort((a, b) => b.hp - a.hp || b.y - a.y || a.id - b.id);
      const brick = crossing[0];
      this.loss = {
        gameIndex: this.gameIndex, turn: this.turn,
        losingBrickId: brick.id,
        losingBrickValue: brick.initialHp,
        losingBrickHp: brick.hp,
      };
      this.lossHistory.push(this.loss);
      this.onLoss?.(this.loss);
      this.phase = 'GAME_OVER';
      this.phaseTime = 0;
      return;
    }
    this.turn++;
    this.bricks.push(...this.levels.newRow(this.turn, this.bricks));
    this.rowTransition = 0.24;
    this.angleSearch = new AngleSearch(this.launchX, this.bricks, this.rng);
    this.phase = 'AIMING';
    this.phaseTime = 0;
  }

  private restart(): void {
    this.gameIndex++;
    this.turn = 1;
    this.score = 0;
    this.ballCount = CONFIG.startingBalls;
    this.phase = 'AIMING';
    this.phaseTime = 0;
    this.shotTime = 0;
    this.launchX = CONFIG.width / 2;
    this.firstLandingX = null;
    this.balls = [];
    this.sparks = [];
    this.fired = 0;
    this.loss = null;
    this.rowTransition = 0;
    this.rowTransitionStep = CONFIG.rowStep;
    this.bricks = this.levels.opening();
    this.angleSearch = null;
    this.angle = aimAtStarter(this.launchX, this.bricks, this.rng);
  }
}
