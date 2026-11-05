#!/usr/bin/env node
// Reports how often the correct answer is the longest option in single-choice
// questions, per exam. A test-taker who can spot "pick the longest" scores well
// above chance without knowing the material, so this should sit near 1/n.
//
//   node scripts/quality/check-answer-length.mjs            table, worst first
//   node scripts/quality/check-answer-length.mjs --json     machine-readable
//   node scripts/quality/check-answer-length.mjs --max 40   exit 1 if any exam is over 40%
//
// "Longest" and "shortest" are strict, by character count: a tie gives no cue.
// Shortest is reported too, because over-lengthening wrong options flips the cue.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const dataPath = flag("--file") ?? fileURLToPath(new URL("../../data.js", import.meta.url));

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(dataPath, "utf8") + ";this.EXAMS = EXAMS;", ctx);

const isSingle = (q) => (q.type === undefined || q.type === "single") && typeof q.correct === "number";

const rows = Object.values(ctx.EXAMS).map((exam) => {
  const qs = exam.questions.filter(isSingle);
  let longest = 0, shortest = 0, chance = 0;
  for (const q of qs) {
    const lens = q.options.map((o) => o.length);
    const max = Math.max(...lens), min = Math.min(...lens);
    if (lens[q.correct] === max && lens.filter((l) => l === max).length === 1) longest++;
    if (lens[q.correct] === min && lens.filter((l) => l === min).length === 1) shortest++;
    chance += 1 / q.options.length;
  }
  const n = qs.length || 1;
  return { code: exam.code, single: qs.length, longest, rate: longest / n, shortest, shortestRate: shortest / n, chance: chance / n };
}).sort((a, b) => b.rate - a.rate);

const total = rows.reduce((a, r) => ({ single: a.single + r.single, longest: a.longest + r.longest, shortest: a.shortest + r.shortest }), { single: 0, longest: 0, shortest: 0 });
const overall = total.longest / total.single;

if (args.includes("--json")) {
  console.log(JSON.stringify({ overall, ...total, exams: rows }, null, 2));
} else {
  const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
  const line = (code, r, rate, sRate) => console.log(`${code.padEnd(9)} ${String(r.single).padStart(6)} ${String(r.longest).padStart(8)}  ${pct(rate)} ${String(r.shortest).padStart(9)}  ${pct(sRate)}`);
  console.log("Exam      Single  Longest    Rate  Shortest    Rate");
  for (const r of rows) line(r.code, r, r.rate, r.shortestRate);
  line("ALL", total, overall, total.shortest / total.single);
}

const max = flag("--max");
if (max !== null) {
  const over = rows.filter((r) => r.rate * 100 > Number(max));
  if (over.length) {
    console.error(`\n${over.length} exam(s) over ${max}%: ${over.map((r) => r.code).join(", ")}`);
    process.exit(1);
  }
}
