import path from "node:path";
import { countTreeEscapes } from "./escapes.js";

const tree = process.argv[2];
if (tree === undefined) throw new Error("usage: yarn escapes <tree>");
console.log(JSON.stringify(countTreeEscapes(path.resolve(tree)), null, 2));
