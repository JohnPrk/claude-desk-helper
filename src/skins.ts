import type { PetState } from "./types";
import pandaIdle from "./skins/panda/idle.svg";
import pandaTired from "./skins/panda/tired.svg";
import pandaSleep from "./skins/panda/sleep.svg";
import pandaDead from "./skins/panda/dead.svg";

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
      tired: pandaTired,
      sleep: pandaSleep,
      dead: pandaDead,
    },
  },
];

export const DEFAULT_SKIN_ID = "panda";

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
