export type ArmId = "js" | "ts" | "ts-noany";

export type Arm = {
  id: ArmId;
  language: "js" | "ts";
  template: string;
  taskRun: string;
  command: string[];
  build: string[] | null;
  verify: string[] | null;
  notes: string;
};

const NODE_VERSION_NOTE = "for Node.js 22 or later. You may add npm packages with `yarn add`.";
const TS_NOTES = [
  `Write the tool in TypeScript ${NODE_VERSION_NOTE}`,
  "The entry point is `src/cli.ts`; `yarn build` compiles it to `dist/cli.js`.",
  "`yarn verify` runs the type checker and must pass. Do not weaken `tsconfig.json`.",
];
const NO_ANY_NOTE =
  "`yarn verify` also runs a lint that bans `any`, type assertions (`as`), non-null assertions (`!`) and comments that turn checks off. Do not change `tsconfig.json` or `eslint.config.js`.";

const tsArm = (id: ArmId, notes: string[]): Arm => ({
  id,
  language: "ts",
  template: id,
  taskRun: "node dist/cli.js",
  command: ["node", "{tree}/dist/cli.js"],
  build: ["yarn", "-s", "build"],
  verify: ["yarn", "-s", "verify"],
  notes: notes.join(" "),
});

export const ARMS: Record<ArmId, Arm> = {
  js: {
    id: "js",
    language: "js",
    template: "js",
    taskRun: "node src/cli.js",
    command: ["node", "{tree}/src/cli.js"],
    build: null,
    verify: null,
    notes: `Write the tool in JavaScript (ES modules) ${NODE_VERSION_NOTE} The entry point is \`src/cli.js\`.`,
  },
  ts: tsArm("ts", TS_NOTES),
  "ts-noany": tsArm("ts-noany", [...TS_NOTES, NO_ANY_NOTE]),
};

export const isArmId = (value: string): value is ArmId => Object.keys(ARMS).includes(value);
