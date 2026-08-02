/**
 * Language detection by extension and filename.
 *
 * Deliberately a lookup table rather than content sniffing: the scanner must
 * not read every file in the repository just to classify it.
 */

const BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  swift: "Swift",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  md: "Markdown",
  mdx: "Markdown",
  txt: "Text",
};

const BY_FILENAME: Readonly<Record<string, string>> = {
  Dockerfile: "Docker",
  Makefile: "Make",
  Gemfile: "Ruby",
  Rakefile: "Ruby",
};

/** Extensions treated as binary without reading the file. */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svgz",
  "pdf", "zip", "gz", "tar", "tgz", "bz2", "xz", "7z", "rar",
  "mp3", "mp4", "wav", "avi", "mov", "webm", "ogg", "flac",
  "woff", "woff2", "ttf", "otf", "eot",
  "exe", "dll", "so", "dylib", "bin", "class", "jar", "war", "wasm",
  "pyc", "pyo", "o", "a", "node", "db", "sqlite", "lock",
]);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function detectLanguage(filename: string): string | null {
  const named = BY_FILENAME[filename];
  if (named !== undefined) {
    return named;
  }

  return BY_EXTENSION[extensionOf(filename)] ?? null;
}

export function isBinaryName(filename: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(filename));
}
