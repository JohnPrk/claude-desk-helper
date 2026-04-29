import type { PetState } from "./types";

export type Skin = {
  id: string;
  name: string;
  frames: Record<PetState, string>;
};

const url = (path: string) => new URL(`./skins/${path}`, import.meta.url).href;

export const SKINS: Skin[] = [
  {
    id: "panda",
    name: "Panda",
    frames: {
      idle: url("panda/idle.png"),
      tired: url("panda/tired.png"),
      sleep: url("panda/sleep.png"),
      dead: url("panda/dead.png"),
    },
  },
];

export const DEFAULT_SKIN_ID = "panda";

export function findSkin(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
