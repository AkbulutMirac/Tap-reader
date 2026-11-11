import { Button, Card, toast } from "@heroui/react";
import { useEffect, useState } from "react";
import { db } from "./db";
import { TARGET_LANGUAGES, updateSettings, useSettings, type Theme } from "./settings";
import { prefetchDictionary, usePrefetchState } from "./translate/prefetch";
import { SelectField, SwitchField } from "./ui/fields";

const THEMES: [Theme, string][] = [
  ["system", "Match device"],
  ["light", "Light"],
  ["sepia", "Sepia"],
  ["dark", "Dark"],
];

const mb = (bytes = 0) => `${(bytes / 1e6).toFixed(1)} MB`;

function OfflineDictionaryStatus() {
  const p = usePrefetchState();
  const text =
    p.status === "ready"
      ? "Offline dictionary: downloaded ✓"
      : p.status === "running"
        ? `Offline dictionary: downloading… ${Math.round((100 * p.done) / Math.max(1, p.total))}%`
        : p.status === "error"
          ? "Offline dictionary: download failed."
          : "Offline dictionary: not downloaded yet.";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{text}</span>
      {p.status !== "running" && (
        <Button size="sm" variant="ghost" onPress={() => void prefetchDictionary(true)}>
          {p.status === "ready" ? "Download again" : "Download now (~2 MB)"}
        </Button>
      )}
    </div>
  );
}

export default function SettingsScreen() {
  const s = useSettings();
  const [storage, setStorage] = useState<StorageEstimate | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then(setStorage, () => {});
  }, []);

  const clearCache = async () => {
    await db.lookups.clear();
    if ("caches" in window) {
      for (const name of await caches.keys()) if (name.includes("translate")) await caches.delete(name);
    }
    toast.success("Translation cache cleared");
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 py-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card className="flex flex-col gap-4 p-4">
        <SelectField
          label="Translate words into"
          value={s.targetLang}
          options={TARGET_LANGUAGES}
          onChange={(targetLang) => updateSettings({ targetLang })}
        />
        <p className="-mt-2 text-xs text-muted">
          Turkish works offline (built-in dictionary). Other languages need an internet connection.
        </p>
        <OfflineDictionaryStatus />
        <SelectField label="Theme" value={s.theme} options={THEMES} onChange={(theme) => updateSettings({ theme })} />
        <SwitchField isSelected={s.ocr} onChange={(ocr) => updateSettings({ ocr })}>
          Read text in scanned pages, photos and comics (OCR)
        </SwitchField>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Storage</h2>
        <p className="text-sm text-muted">
          Your books, words and settings are stored only on this device.
          {storage && ` Using ${mb(storage.usage)} of ${mb(storage.quota)}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onPress={clearCache}>
            Clear translation cache
          </Button>
        </div>
        <p className="text-xs text-muted">To move your words to another device, use Words → Backup, then Import there.</p>
      </Card>

      <Card className="flex flex-col gap-2 p-4 text-sm">
        <h2 className="font-semibold">About</h2>
        <p className="text-muted">TapReader — tap any word to see what it means.</p>
        <ul className="list-disc pl-5 text-xs text-muted">
          <li>
            English–Turkish dictionary:{" "}
            <a className="underline" href="https://www.wikdict.com" target="_blank" rel="noreferrer">
              WikDict
            </a>{" "}
            from Wiktionary, CC BY-SA 3.0
          </li>
          <li>English definitions: Princeton WordNet 3.1 (WordNet License)</li>
          <li>Online translations: Google Translate, MyMemory</li>
          <li>PDF.js (Apache 2.0) · foliate-js (MIT) · Tesseract.js (Apache 2.0) · HeroUI (MIT)</li>
        </ul>
      </Card>
    </div>
  );
}
