import type { PetState } from "./types";
import pandaFull from "./skins/panda/full.png";
import pandaHigh from "./skins/panda/high.png";
import pandaGood from "./skins/panda/good.png";
import pandaMid from "./skins/panda/mid.png";
import pandaLow from "./skins/panda/low.png";
import pandaTired from "./skins/panda/tired.png";
import pandaSleepy from "./skins/panda/sleepy.png";
import pandaDead from "./skins/panda/dead.png";

// disconnected 상태에서는 캐릭터 본체는 평소 모습(good)을 그대로 쓰고,
// 그 위에 "연결 실패" 나무 표지판 오버레이를 캐릭터 앞에 띄운다.
import pandaDisconnected from "./skins/panda/good.png";
import pandaDisconnectedSign from "./skins/panda/disconnected_sign.png";

import pandaBamboo from "./skins/panda/bamboo.png";
import pandaApple from "./skins/panda/apple.png";
import pandaDumbbell from "./skins/panda/dumbbell.png";

// Action names used by the idle micro-action loop in App.tsx.
// A skin can optionally provide a .gif for any of these to express the
// motion via the gif itself instead of relying on CSS transforms.
export type ActionName =
  | "roll"
  | "jump"
  | "run"
  | "scratch"
  | "wobble"
  | "squish";

export type Skin = {
  id: string;
  name: string;
  /** Static PNG (or any image) per pet state. Required. */
  frames: Record<PetState, string>;
  /**
   * Optional motion GIFs per idle action. If a gif is provided for an
   * action, the renderer swaps the static state PNG for the gif while
   * the action plays. If absent, the static PNG remains visible and the
   * existing CSS keyframes provide a fallback motion.
   */
  actions?: Partial<Record<ActionName, string>>;
};

export const SKINS: Skin[] = [
  {
    id: "panda",
    name: "Panda",
    frames: {
      full: pandaFull,
      high: pandaHigh,
      good: pandaGood,
      mid: pandaMid,
      low: pandaLow,
      tired: pandaTired,
      sleepy: pandaSleepy,
      dead: pandaDead,
      disconnected: pandaDisconnected,
    },
    // No motion GIFs yet — drop files into src/skins/panda/<action>.gif and
    // wire them up here (e.g. `roll: pandaRollGif`) to enable per-action
    // gif playback. Until then, CSS keyframes animate the static PNG.
    actions: {},
  },
];

export const ACCESSORIES = {
  bamboo: pandaBamboo,
  apple: pandaApple,
  dumbbell: pandaDumbbell,
  disconnectedSign: pandaDisconnectedSign,
};

export const DEFAULT_SKIN_ID = "panda";

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
