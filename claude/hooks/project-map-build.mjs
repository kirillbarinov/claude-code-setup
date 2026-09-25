#!/usr/bin/env node
// project-map-build.mjs — генератор карты проекта (слой фактов)
//
// Пишет в CLAUDE.md каждой значимой папки блок между маркерами
// КАРТА:НАЧАЛО / КАРТА:КОНЕЦ. Всё, что вне блока, не трогает никогда:
// там живёт слой смысла, который из кода не выводится.
//
//   node project-map-build.mjs [--dry] [--force] [--root ПУТЬ] [--only ПОДСТРОКА]
//
// --force пересчитать даже те карты, что свежее кода
//
// --dry   напечатать, ничего не записывая
// --only  ограничиться папками, чей путь содержит подстроку

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join, relative, basename, dirname, sep } from "node:path";
import { execFileSync } from "node:child_process";

const BEGIN = "<!-- КАРТА:НАЧАЛО — блок пересчитывается автоматически, правки в нём затрутся -->";
const END = "<!-- КАРТА:КОНЕЦ -->";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const ROOT = argOf("--root") || process.cwd();
const ONLY = argOf("--only");
const MAX_DIRS = 40;

function argOf(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

// Папки, в которые не заходим ни при каких условиях.
const SKIP = new Set([
  ".git", "node_modules", "build", "dist", "out", "target", "bin", "obj",
  ".gradle", ".idea", ".vscode", "venv", ".venv", "__pycache__", ".next",
  "vendor", "coverage", ".cache", ".worktrees", ".planning",
]);

const BUILD_FILES = [
  "build.gradle", "build.gradle.kts", "pom.xml", "package.json",
  "pyproject.toml", "Cargo.toml", "go.mod", "composer.json", "Gemfile",
];

const CODE_EXT = new Set([
  ".java", ".kt", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".rb", ".php", ".cs", ".swift", ".sql", ".vue", ".svelte", ".scala",
]);

// ---------- что считать файлами проекта ----------
//
// Список берём у git, а не у файловой системы. Это снимает сразу три вопроса:
// какие папки мусорные (git уже знает по .gitignore — tiles, build, node_modules),
// откуда взять полный список без обхода гигабайтов, и как не писать в генераторе
// имена папок конкретного проекта. `--others --exclude-standard` добавляет файлы,
// которые ещё не закоммичены, но и не игнорируются: новый модуль виден сразу.
function gitFiles() {
  try {
    const out = execFileSync("git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const list = out.split("\0").filter(Boolean).map((p) => join(ROOT, p));
    return list.length ? list.sort() : null;
  } catch { return null; }
}

const TRACKED = gitFiles();

// Файлы под папкой — срез отсортированного списка по префиксу, два бинарных
// поиска вместо рекурсивного обхода. На миллионах строк это и есть разница.
function lowerBound(arr, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < key) lo = m + 1; else hi = m; }
  return lo;
}

function filesUnderTracked(dir) {
  const from = dir + sep;
  const i = lowerBound(TRACKED, from);
  const out = [];
  for (let k = i; k < TRACKED.length && TRACKED[k].startsWith(from); k++) out.push(TRACKED[k]);
  return out;
}

// ---------- обход ----------

function walk(dir, depth, acc) {
  if (depth > 4) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    // Папки на «_» — служебные по конвенции (_research, _drafts): своей карты
    // не заслуживают. Внутрь модуля это правило не переносится (см. filesUnder).
    if (!e.isDirectory() || SKIP.has(e.name) ||
        e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const full = join(dir, e.name);
    acc.push(full);
    walk(full, depth + 1, acc);
  }
}

function filesUnder(dir, depth = 0, acc = []) {
  if (depth === 0 && TRACKED) return filesUnderTracked(dir);
  if (depth > 12) return acc;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      filesUnder(full, depth + 1, acc);
    } else acc.push(full);
  }
  return acc;
}

const ext = (f) => { const i = f.lastIndexOf("."); return i === -1 ? "" : f.slice(i); };
const isCode = (f) => CODE_EXT.has(ext(f));
const isTest = (f) => /(^|[._/-])(test|spec|tests)([._/-]|$)/i.test(basename(f)) ||
                      f.includes(`${sep}test${sep}`) || f.includes(`${sep}tests${sep}`);

// Значимая папка: имеет build-файл (это модуль) либо содержит достаточно кода
// и лежит неглубоко. Без этого фильтра карта расползётся на сотни файлов.
function significant(dir) {
  const hasBuild = BUILD_FILES.some((b) => existsSync(join(dir, b)));
  const code = filesUnder(dir).filter(isCode);
  const depth = relative(ROOT, dir).split(sep).length;
  if (hasBuild && code.length >= 3) return true;
  if (depth <= 2 && code.length >= 12) return true;
  return false;
}

// ---------- сбор фактов ----------

function entryPoints(files) {
  const byName = [
    /^main\.(py|go|rs|ts|js)$/, /^index\.(ts|tsx|js|jsx)$/,
    /^app\.(py|ts|tsx|js)$/, /^server\.(ts|js|py)$/, /^__main__\.py$/, /^cli\.(ts|js|py)$/,
  ];
  // В JVM имя ничего не гарантирует: TrustWorker и ApiApplication — тоже входы,
  // а какой-нибудь Main может быть утилитой. Смотрим в файл.
  const byBody = /(static\s+void\s+main\s*\(|@SpringBootApplication)/;
  return files.filter((f) => {
    if (byName.some((p) => p.test(basename(f)))) return true;
    if (!/\.(java|kt)$/.test(f)) return false;
    try { return byBody.test(readFileSync(f, "utf-8")); } catch { return false; }
  });
}

function commands(dir) {
  const out = [];
  const pkg = join(dir, "package.json");
  if (existsSync(pkg)) {
    try {
      const s = JSON.parse(readFileSync(pkg, "utf-8")).scripts || {};
      for (const k of ["dev", "build", "test", "lint", "start"])
        if (s[k]) out.push(`\`npm run ${k}\``);
    } catch {}
  }
  if (existsSync(join(dir, "build.gradle")) || existsSync(join(dir, "build.gradle.kts"))) {
    // settings.gradle означает корень сборки: у него нет своего :имени.
    const root = existsSync(join(dir, "settings.gradle")) || existsSync(join(dir, "settings.gradle.kts"));
    const t = root ? "" : `:${basename(dir)}`;
    out.push(`\`./gradlew ${t}:build\``.replace(" :build", " build"),
             `\`./gradlew ${t}:test\``.replace(" :test", " test"));
  }
  if (existsSync(join(dir, "pyproject.toml"))) out.push("`pytest`");
  if (existsSync(join(dir, "Cargo.toml"))) out.push("`cargo build`", "`cargo test`");
  if (existsSync(join(dir, "go.mod"))) out.push("`go build ./...`", "`go test ./...`");
  return out;
}

// Группировка файлов по непосредственной папке — это и есть индекс «что где».
function index(dir, files) {
  const groups = new Map();
  for (const f of files) {
    const rel = relative(dir, f);
    const parts = rel.split(sep);
    const key = parts.slice(0, -1).join("/") || ".";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(basename(f));
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([k, v]) => {
      // Длинные однообразные пути пакетов сокращаем: важен хвост.
      const short = k.length > 44 ? "…/" + k.split("/").slice(-2).join("/") : k;
      const names = v.sort().slice(0, 7).join(", ") + (v.length > 7 ? `, +${v.length - 7}` : "");
      return { path: short === "." ? "(корень)" : `\`${short}/\``, names };
    });
}

// Папка-агрегатор (platform/ с семью gradle-модулями внутри) не описывается
// файлами: её содержание — это перечень модулей. Файлы опишет каждый модуль сам.
function buildAggregateBlock(dir, children) {
  const rel = relative(ROOT, dir) || ".";
  const lines = [BEGIN, ""];
  lines.push(`**\`${rel}\`** · сборка из ${children.length} модулей`, "");
  lines.push("| Модуль | Размер | Точка входа |", "|---|---|---|");
  for (const c of children) {
    const code = filesUnder(c).filter(isCode).filter((f) => !isTest(f));
    const eps = entryPoints(code).map((f) => `\`${basename(f)}\``).join(", ") || "—";
    lines.push(`| \`${basename(c)}/\` | ${code.length} файлов | ${eps} |`);
  }
  lines.push("", "Подробности каждого модуля — в его собственном `CLAUDE.md`.", "");
  const cmds = commands(dir);
  if (cmds.length) lines.push(`Команды: ${cmds.join(" · ")}`, "");
  lines.push(`<sub>Пересчитано ${new Date().toISOString().slice(0, 10)}.</sub>`, "", END);
  return lines.join("\n");
}

function buildBlock(dir) {
  const all = filesUnder(dir);
  const code = all.filter(isCode);
  if (code.length === 0) return null;

  const prod = code.filter((f) => !isTest(f));
  const tests = code.filter(isTest);
  const rel = relative(ROOT, dir) || ".";

  const byExt = new Map();
  for (const f of code) byExt.set(ext(f), (byExt.get(ext(f)) || 0) + 1);
  const langs = [...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([e, n]) => `${n} ${e.slice(1)}`).join(", ");

  const lines = [BEGIN, ""];
  lines.push(`**\`${rel}\`** · ${langs}` +
             (tests.length ? ` · тестов ${tests.length}` : " · **тестов нет**"));
  lines.push("");

  const eps = entryPoints(prod);
  if (eps.length) lines.push(`Точка входа: ${eps.map((f) => `\`${relative(dir, f)}\``).join(", ")}`, "");

  const rows = index(dir, prod);
  if (rows.length) {
    lines.push("| Где | Что лежит |", "|---|---|");
    for (const r of rows) lines.push(`| ${r.path} | ${r.names} |`);
    lines.push("");
  }

  const cmds = commands(dir);
  if (cmds.length) lines.push(`Команды: ${cmds.join(" · ")}`, "");

  lines.push(`<sub>Пересчитано ${new Date().toISOString().slice(0, 10)} по ${code.length} файлам.</sub>`);
  lines.push("", END);
  return lines.join("\n");
}

// ---------- запись, не задевая слой смысла ----------

function apply(dir, block) {
  const file = join(dir, "CLAUDE.md");
  const name = basename(dir);
  let text = existsSync(file) ? readFileSync(file, "utf-8") : "";

  if (text.includes(BEGIN) && text.includes(END)) {
    const head = text.slice(0, text.indexOf(BEGIN));
    const tail = text.slice(text.indexOf(END) + END.length);
    return { file, text: head + block + tail, mode: "обновлён" };
  }

  if (text.trim()) {
    // Файл вели вручную — блок фактов дописываем сверху, чужое не трогаем.
    return { file, text: block + "\n\n" + text, mode: "блок добавлен" };
  }

  const fresh = [
    `# ${name}`, "", block, "", "## Правила модуля", "",
    "<!-- Пишется по ходу работы, автоматика сюда не заходит.",
    "     Сюда идёт то, что из кода не выводится: зачем модуль нужен,",
    "     что здесь нельзя ломать, какие грабли уже собрали. -->", "",
    "пока не заполнено", "",
  ].join("\n");
  return { file, text: fresh, mode: "создан" };
}

// ---------- main ----------

const dirs = [];
if (TRACKED) {
  const seen = new Set();
  for (const f of TRACKED) {
    let d = dirname(f);
    while (d.length > ROOT.length && !seen.has(d)) {
      seen.add(d);
      d = dirname(d);
    }
  }
  for (const d of seen) {
    const parts = relative(ROOT, d).split(sep);
    if (parts.length > 4) continue;                       // глубже карта не нужна
    if (parts.some((p) => p.startsWith("_") || p.startsWith("."))) continue;
    if (parts.some((p) => SKIP.has(p))) continue;
    dirs.push(d);
  }
} else {
  walk(ROOT, 0, dirs);                                    // проект без git
}
let targets = dirs.filter(significant);
if (ONLY) targets = targets.filter((d) => d.includes(ONLY));

// Настоящий модуль — тот, у кого есть свой build-файл. Папку без него,
// лежащую внутри модуля, отдельно не описываем: её опишет модуль.
const isModule = (d) => BUILD_FILES.some((b) => existsSync(join(d, b)));
targets = targets.filter((d) =>
  isModule(d) || !targets.some((o) => o !== d && isModule(o) && d.startsWith(o + sep)));
targets = targets.slice(0, MAX_DIRS);

// Кто из отобранных — агрегатор, то есть содержит внутри другие модули.
const childrenOf = new Map(
  targets.map((d) => [d, targets.filter((o) => o !== d && isModule(o) && o.startsWith(d + sep))]));

// Ноль живых модулей — это не повод выходить: именно тогда сироты и остаются.
if (targets.length === 0) {
  const gone = DRY || ONLY ? [] : sweepOrphans([]);
  console.log(gone.length ? gone.join("\n") : "значимых папок не найдено");
  process.exit(0);
}

// Модуль снесли или переименовали — его карта осталась и теперь врёт.
// Удаляем только те, где нет ни строчки рукописного: смысловой слой не наш.
function sweepOrphans(alive) {
  const live = new Set(alive.map((d) => join(d, "CLAUDE.md")));
  const all = [];
  walk(ROOT, 0, all);
  all.push(ROOT);
  const gone = [];
  for (const d of all) {
    const f = join(d, "CLAUDE.md");
    if (live.has(f) || !existsSync(f)) continue;
    let text;
    try { text = readFileSync(f, "utf-8"); } catch { continue; }
    if (!text.includes(BEGIN)) continue;          // писали руками, не наше

    const outside = (text.slice(0, text.indexOf(BEGIN)) +
                     text.slice(text.indexOf(END) + END.length))
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^#.*$/m, "")
      .replace(/^## Правила модуля$/m, "")
      .replace(/пока не заполнено/g, "")
      .trim();

    if (outside) {
      // Человек сюда писал. Не удаляем — предупреждаем прямо в файле.
      const warn = "> **Модуля больше нет.** Карта не пересчитывается; текст ниже сохранён.\n\n";
      if (!text.includes("Модуля больше нет")) {
        try { writeFileSync(f, warn + text, "utf-8"); gone.push(`помечен       ${relative(ROOT, f)}`); } catch {}
      }
    } else {
      try { unlinkSync(f); gone.push(`удалён        ${relative(ROOT, f)}`); } catch {}
    }
  }
  return gone;
}

const report = [];
let skipped = 0;
for (const d of targets) {
  // Карта производна от кода: пока код не менялся, пересчитывать нечего.
  if (!DRY && !args.includes("--force")) {
    const md = join(d, "CLAUDE.md");
    if (existsSync(md)) {
      const mdAt = statSync(md).mtimeMs;
      const codeAt = filesUnder(d).filter(isCode)
        .reduce((m, f) => { try { return Math.max(m, statSync(f).mtimeMs); } catch { return m; } }, 0);
      if (codeAt <= mdAt) { skipped++; continue; }
    }
  }

  const kids = childrenOf.get(d) || [];
  const block = kids.length ? buildAggregateBlock(d, kids) : buildBlock(d);
  if (!block) continue;
  const res = apply(d, block);
  if (DRY) {
    report.push(`\n──── ${relative(ROOT, d)} — ${res.mode} ────\n${block}`);
  } else {
    writeFileSync(res.file, res.text, "utf-8");
    report.push(`${res.mode.padEnd(14)} ${relative(ROOT, res.file)}`);
  }
}
if (!ONLY) {
  const gone = DRY ? [] : sweepOrphans(targets);
  for (const g of gone) report.push(g);
}
console.log(report.join("\n"));
console.log(`\nПапок: ${targets.length}, пропущено как свежие: ${skipped}` +
  (DRY ? " (пробный прогон, ничего не записано)" : ""));
