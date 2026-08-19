// Dev utility: run the extractor + Tailwind compiler against a fixture.
//   NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-extract.ts [file]
import { readFileSync } from "node:fs";
import { extractPage } from "../src/lib/importer/extract";
import { compilePageCss } from "../src/lib/importer/tailwind";

async function main() {
  const file = process.argv[2] ?? "fixtures/demo-page.tsx";
  const src = readFileSync(file, "utf8");
  const result = await extractPage(src);
  console.log("TITLE:", result.title);
  console.log("FIELDS:", result.fields.length, "text:", result.report.textFields, "image:", result.report.imageFields);
  console.log("SECTIONS:", [...new Set(result.fields.map((f) => f.section))].join(", "));
  console.log("SAMPLE KEYS:");
  for (const f of result.fields.slice(0, 14)) console.log("  ", f.type, f.key, "=", JSON.stringify(f.defaultValue.slice(0, 50)));
  console.log("HANDLERS:", result.report.strippedHandlers);
  console.log("UNKNOWN:", result.report.unknownComponents);
  console.log("ICONS:", result.report.renderedIcons);
  console.log("NOTES:", result.report.notes);
  console.log("DROPPED:", result.report.droppedExpressions);
  const json = JSON.stringify(result.tree);
  console.log("TREE BYTES:", json.length);

  const css = await compilePageCss(result.tree);
  console.log("CSS BYTES:", css.length);
  console.log("CSS has bg-primary:", css.includes("bg-primary"));
  console.log("CSS has grid-cols:", css.includes("grid-template-columns"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
