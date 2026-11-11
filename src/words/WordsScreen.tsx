import { Button, Card, SearchField, Tabs, toast } from "@heroui/react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { db, type SavedWord } from "../db";
import { IconDownload, IconTrash, IconUpload } from "../ui/icons";
import { downloadFile, makeBackup, restoreBackup, wordsToCsv } from "./backup";
import { Emphasize } from "./Emphasize";
import { ReviewPanel } from "./ReviewPanel";
import { isDue } from "./review";

export default function WordsScreen() {
  const words = useLiveQuery(() => db.words.orderBy("savedAt").reverse().toArray(), []) ?? [];
  const [tab, setTab] = useState<string>("list");
  const due = words.filter((w) => isDue(w)).length;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-3">
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="flex min-h-0 flex-1 flex-col">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Word list views">
            <Tabs.Tab id="list">
              My words ({words.length})
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="review">
              Review{due ? ` (${due} due)` : ""}
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="list" className="min-h-0 flex-1 overflow-y-auto pt-3">
          <WordList words={words} />
        </Tabs.Panel>
        <Tabs.Panel id="review" className="min-h-0 flex-1 overflow-y-auto pt-3">
          <ReviewPanel words={words} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function WordList({ words }: { words: SavedWord[] }) {
  const [query, setQuery] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return words;
    return words.filter((w) => [w.word, w.lemma, w.translation, w.sentence].some((s) => s?.toLowerCase().includes(q)));
  }, [words, query]);

  const exportBackup = async () => {
    const backup = await makeBackup();
    downloadFile(`tapreader-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup), "application/json");
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await restoreBackup(JSON.parse(await file.text()));
      toast.success("Backup imported", {
        description: `${r.words} words, ${r.bookmarks} bookmarks, ${r.highlights} highlights added or updated.`,
      });
    } catch (err) {
      toast.danger("Couldn't import", { description: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label="Search words" value={query} onChange={setQuery} className="min-w-48 flex-1">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search words, meanings, sentences" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Button size="sm" variant="secondary" onPress={exportBackup}>
          <IconDownload size={16} /> Backup
        </Button>
        <Button size="sm" variant="secondary" onPress={() => importRef.current?.click()}>
          <IconUpload size={16} /> Import
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!words.length}
          onPress={() => downloadFile("tapreader-words.csv", wordsToCsv(words), "text/csv")}
        >
          <IconDownload size={16} /> CSV (Anki)
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void importBackup(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {words.length === 0 && (
        <p className="py-10 text-center text-muted">
          No saved words yet. While reading, tap a word and press <b>☆ Save</b>.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((w) => (
          <li key={w.word}>
            <Card className="p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{w.word}</span>
                    {w.lemma && <span className="text-xs text-muted">({w.lemma})</span>}
                    <span className="text-accent">{w.translation}</span>
                  </div>
                  {w.sentence && (
                    <p className="mt-1 text-sm text-muted">
                      <Emphasize text={w.sentence} word={w.word} />
                    </p>
                  )}
                  {(w.bookTitle || w.location) && (
                    <p className="mt-1 text-xs text-muted">
                      {[w.bookTitle, w.location].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${w.word}`}
                  onPress={() => db.words.delete(w.word)}
                >
                  <IconTrash size={16} />
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
