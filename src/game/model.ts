export type GamePhase = 'AIMING' | 'FIRING' | 'RESOLVING' | 'ADVANCING' | 'GAME_OVER';

export interface Brick {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  initialHp: number;
  hue: number;
  armor?: number;
  impacts?: number;
  starter?: boolean;
  hitFlash?: number;
}

export interface Ball {
  x: number;
  y: number;
  previousX?: number;
  previousY?: number;
  vx: number;
  vy: number;
  age: number;
  lastBrickId: number;
  lastBrickAt: number;
}

export interface Spark {
  x: number;
  y: number;
  life: number;
  hue: number;
}

export interface LossRecord {
  gameIndex: number;
  turn: number;
  losingBrickId: number;
  losingBrickValue: number;
  losingBrickHp: number;
}
