import type { PetState } from "./types";
import pandaIdle from "./skins/panda/idle.svg";
import pandaCheerful from "./skins/panda/cheerful.svg";
import pandaTired from "./skins/panda/tired.svg";
import pandaWeary from "./skins/panda/weary.svg";
import pandaSleepy from "./skins/panda/sleepy.svg";
import pandaSleep from "./skins/panda/sleep.svg";
import pandaDead from "./skins/panda/dead.svg";

import pandaBamboo from "./skins/panda/bamboo.svg";
import pandaApple from "./skins/panda/apple.svg";
import pandaDumbbell from "./skins/panda/dumbbell.svg";

export type Skin = {
  id: string;
  name: string;
  frames: Record<PetState, string>;
};

export const SKINS: Skin[] = [
  {
    id: "panda",
    name: "Panda",
    frames: {
      idle: pandaIdle,
      cheerful: pandaCheerful,
      tired: pandaTired,
      weary: pandaWeary,
      sleepy: pandaSleepy,
      sleep: pandaSleep,
      dead: pandaDead,
    },
  },
];

export const ACCESSORIES = {
  bamboo: pandaBamboo,
  apple: pandaApple,
  dumbbell: pandaDumbbell,
};

export const DEFAULT_SKIN_ID = "panda";

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
