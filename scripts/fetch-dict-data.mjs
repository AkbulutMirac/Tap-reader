// Downloads the raw dictionary sources into data/ (needed only to rebuild public/dict/).
//   WikDict en-tr (Wiktionary, CC BY-SA 3.0)       ~8 MB
//   Princeton WordNet 3.1 (WordNet License)        ~16 MB
//   FrequencyWords en_50k (CC BY-SA 4.0), for the coverage test
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const data = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(data, { recursive: true });

const files = [
  ["en-tr.sqlite3", "https://download.wikdict.com/dictionaries/sqlite/2/en-tr.sqlite3"],
  ["wn3.1.dict.tar.gz", "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz"],
  ["en_50k.txt", "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"],
];

for (const [name, url] of files) {
  if (existsSync(data + name)) continue;
  console.log(`downloading ${name}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(data + name, Buffer.from(await res.arrayBuffer()));
}
if (!existsSync(data + "dict")) execFileSync("tar", ["-xzf", "wn3.1.dict.tar.gz"], { cwd: data, stdio: "inherit" });
console.log("dictionary sources ready in data/");
