import type { Pack } from "../core/types.js";
import { cppPack } from "./cpp.js";
import { csharpPack } from "./csharp.js";
import { dartPack } from "./dart.js";
import { elixirPack } from "./elixir.js";
import { goPack } from "./go.js";
import { javaPack } from "./java.js";
import { jsTsPack } from "./js-ts.js";
import { kotlinPack } from "./kotlin.js";
import { phpPack } from "./php.js";
import { pythonPack } from "./python.js";
import { rPack } from "./r.js";
import { rubyPack } from "./ruby.js";
import { rustPack } from "./rust.js";
import { scalaPack } from "./scala.js";
import { swiftPack } from "./swift.js";

export const ALL_PACKS: readonly Pack[] = [
  jsTsPack, pythonPack, javaPack, phpPack, rubyPack, goPack, rustPack, csharpPack,
  kotlinPack, swiftPack, dartPack, cppPack, elixirPack, scalaPack, rPack,
];

export function findPack(id: string): Pack {
  const pack = ALL_PACKS.find((candidate) => candidate.id === id);
  if (!pack) throw new Error(`Unknown pack: ${id}`);
  return pack;
}
