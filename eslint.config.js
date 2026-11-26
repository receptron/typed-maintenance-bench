import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "experiments/**/reference/", "experiments/**/templates/", "results/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "max-lines-per-function": ["error", { max: 20, skipBlankLines: true, skipComments: true }],
    },
  },
  { files: ["test/**"], rules: { "max-lines-per-function": "off" } },
);
