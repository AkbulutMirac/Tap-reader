import { Button, SearchField, Spinner, Tabs, TextArea } from "@heroui/react";
import { useRef, useState } from "react";
import { db, type Bookmark, type Highlight } from "../db";
import { updateSettings, type Settings, type Theme } from "../settings";
import { IconTrash, IconZoomIn, IconZoomOut } from "../ui/icons";
import { SelectField } from "../ui/fields";
import type { EngineHandle, SearchHit, TocItem } from "./types";

/* ---- Table of contents ------------------------------------------------------------------ */

export function TocPanel({ toc, onGo }: { toc: TocItem[]; onGo: (location: string) => void }) {
  if (!toc.length) return <p className="p-2 text-sm text-muted">This book has no table of contents.</p>;
  const render = (items: TocItem[], depth: number) => (
    <ul>
      {items.map((item, i) => (
        <li key={`${item.location}-${i}`}>
          <button
            type="button"
            className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-default"
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => onGo(item.location)}
          >
            {item.label}
          </button>
          {item.subitems?.length ? render(item.subitems, depth + 1) : null}
        </li>
      ))}
    </ul>
  );
  return render(toc, 0);
}

/* ---- Search ----------------------------------------------------------------------------- */

export function SearchPanel({ engine, onGo }: { engine: EngineHandle | null; onGo: (location: string) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const run = async (q: string) => {
    abort.current?.abort();
    engine?.clearSearch();
    setHits([]);
    if (!q.trim() || !engine) return;
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    const found: SearchHit[] = [];
    let flush = 0;
    try {
      await engine.search(
        q,
        (hit) => {
          found.push(hit);
          cancelAnimationFrame(flush);
          flush = requestAnimationFrame(() => !ac.signal.aborted && setHits([...found]));
        },
        ac.signal,
      );
    } finally {
      if (!ac.signal.aborted) {
        setHits([...found]);
        setRunning(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <SearchField aria-label="Search in book" value={query} onChange={setQuery} onSubmit={run} autoFocus>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search in this book" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <p className="text-xs text-muted">
        {running ? (
          <span className="inline-flex items-center gap-2">
            <Spinner size="sm" /> Searching… {hits.length} found
          </span>
        ) : query && hits.length === 0 ? (
          "Press Enter to search."
        ) : (
          hits.length > 0 && `${hits.length} results`
        )}
      </p>
      <ul className="flex flex-col">
        {hits.slice(0, 500).map((h, i) => (
          <li key={i}>
            <button
              type="button"
              className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-default"
              onClick={() => onGo(h.location)}
            >
              {h.label && <span className="block text-xs text-muted">{h.label}</span>}
              <span className="text-muted">…{h.pre}</span>
              <mark className="rounded bg-warning/40 px-0.5 text-foreground">{h.match}</mark>
              <span className="text-muted">{h.post}…</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- Bookmarks & highlights --------------------------------------------------------------- */

export function MarksPanel({
  bookmarks,
  highlights,
  onGo,
}: {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  onGo: (location: string) => void;
}) {
  return (
    <Tabs defaultSelectedKey="highlights">
      <Tabs.ListContainer>
        <Tabs.List aria-label="Bookmarks and highlights">
          <Tabs.Tab id="highlights">
            Highlights ({highlights.length})
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="bookmarks">
            Bookmarks ({bookmarks.length})
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="highlights" className="pt-2">
        {highlights.length === 0 && (
          <p className="p-2 text-sm text-muted">Select text, then press Highlight in the bar at the bottom.</p>
        )}
        <ul className="flex flex-col gap-2">
          {highlights.map((h) => (
            <HighlightItem key={h.id} h={h} onGo={onGo} />
          ))}
        </ul>
      </Tabs.Panel>
      <Tabs.Panel id="bookmarks" className="pt-2">
        {bookmarks.length === 0 && <p className="p-2 text-sm text-muted">Use the bookmark button in the top bar.</p>}
        <ul className="flex flex-col">
          {bookmarks.map((b) => (
            <li key={b.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-default"
                onClick={() => onGo(b.location)}
              >
                {b.label}
                <span className="block text-xs text-muted">{new Date(b.createdAt).toLocaleString()}</span>
              </button>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Delete bookmark" onPress={() => db.bookmarks.delete(b.id!)}>
                <IconTrash size={16} />
              </Button>
            </li>
          ))}
        </ul>
      </Tabs.Panel>
    </Tabs>
  );
}

const SWATCH: Record<Highlight["color"], string> = {
  yellow: "bg-yellow-300",
  green: "bg-green-400",
  blue: "bg-blue-400",
  pink: "bg-pink-400",
};

function HighlightItem({ h, onGo }: { h: Highlight; onGo: (location: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(h.note ?? "");
  return (
    <li className="rounded-lg border border-separator p-2">
      <button type="button" className="w-full text-left text-sm" onClick={() => onGo(h.location)}>
        <span className={`mr-2 inline-block h-3 w-3 rounded-full align-middle ${SWATCH[h.color]}`} />
        <span className="line-clamp-4">{h.text}</span>
        <span className="mt-1 block text-xs text-muted">{h.label}</span>
      </button>
      {h.note && !editing && <p className="mt-1 text-sm italic">{h.note}</p>}
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <TextArea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button
              size="sm"
              onPress={async () => {
                await db.highlights.update(h.id!, { note: note.trim() || undefined });
                setEditing(false);
              }}
            >
              Save note
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex gap-1">
          <Button size="sm" variant="ghost" onPress={() => setEditing(true)}>
            {h.note ? "Edit note" : "Add note"}
          </Button>
          {(Object.keys(SWATCH) as Highlight["color"][]).map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              className={`h-7 w-7 rounded-full ${SWATCH[c]} ${c === h.color ? "ring-2 ring-foreground" : ""}`}
              onClick={() => db.highlights.update(h.id!, { color: c })}
            />
          ))}
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Delete highlight"
            onPress={() => db.highlights.delete(h.id!)}
          >
            <IconTrash size={16} />
          </Button>
        </div>
      )}
    </li>
  );
}

/* ---- Display settings --------------------------------------------------------------------- */

const THEMES: [Theme, string, string][] = [
  ["light", "Light", "bg-white text-zinc-900"],
  ["sepia", "Sepia", "bg-[#f6efdc] text-[#4a3b28]"],
  ["dark", "Dark", "bg-zinc-900 text-zinc-100"],
  ["system", "Auto", "bg-gradient-to-r from-white to-zinc-900 text-zinc-500"],
];

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <Button isIconOnly size="sm" variant="secondary" aria-label={`Decrease ${label}`} onPress={onMinus}>
          −
        </Button>
        <span className="w-14 text-center text-sm tabular-nums">{value}</span>
        <Button isIconOnly size="sm" variant="secondary" aria-label={`Increase ${label}`} onPress={onPlus}>
          +
        </Button>
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function DisplayPanel({ settings: s, kind }: { settings: Settings; kind: "pdf" | "comic" | "text" }) {
  const isPdf = kind !== "text";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-2">
        {THEMES.map(([id, label, cls]) => (
          <button
            key={id}
            type="button"
            className={`rounded-xl border-2 py-3 text-sm font-medium ${cls} ${s.theme === id ? "border-accent" : "border-separator"}`}
            onClick={() => updateSettings({ theme: id })}
          >
            {label}
          </button>
        ))}
      </div>

      {isPdf && <p className="-mb-2 text-xs text-muted">Tip: pinch with two fingers to zoom, drag with one.</p>}
      {kind === "comic" && (
        <SelectField
          label="Page turning"
          value={s.flow}
          options={[
            ["paginated", "One page at a time (swipe)"],
            ["scrolled", "Continuous scroll (webtoon)"],
          ]}
          onChange={(flow) => updateSettings({ flow })}
        />
      )}
      {isPdf ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Zoom</span>
          <div className="flex items-center gap-2">
            <Button isIconOnly size="sm" variant="secondary" aria-label="Zoom out" onPress={() => updateSettings({ pdfZoom: clamp(+(s.pdfZoom - 0.25).toFixed(2), 0.5, 4) })}>
              <IconZoomOut size={18} />
            </Button>
            <Button size="sm" variant="ghost" onPress={() => updateSettings({ pdfZoom: 1 })}>
              {Math.round(s.pdfZoom * 100)}% · fit
            </Button>
            <Button isIconOnly size="sm" variant="secondary" aria-label="Zoom in" onPress={() => updateSettings({ pdfZoom: clamp(+(s.pdfZoom + 0.25).toFixed(2), 0.5, 4) })}>
              <IconZoomIn size={18} />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Stepper
            label="Text size"
            value={`${s.fontSize}%`}
            onMinus={() => updateSettings({ fontSize: clamp(s.fontSize - 10, 60, 250) })}
            onPlus={() => updateSettings({ fontSize: clamp(s.fontSize + 10, 60, 250) })}
          />
          <Stepper
            label="Line spacing"
            value={s.lineHeight.toFixed(1)}
            onMinus={() => updateSettings({ lineHeight: clamp(+(s.lineHeight - 0.1).toFixed(1), 1, 2.5) })}
            onPlus={() => updateSettings({ lineHeight: clamp(+(s.lineHeight + 0.1).toFixed(1), 1, 2.5) })}
          />
          <Stepper
            label="Margins"
            value={`${s.margin}%`}
            onMinus={() => updateSettings({ margin: clamp(s.margin - 2, 0, 20) })}
            onPlus={() => updateSettings({ margin: clamp(s.margin + 2, 0, 20) })}
          />
          <SelectField
            label="Font"
            value={s.font}
            options={[
              ["publisher", "Book's own font"],
              ["serif", "Serif"],
              ["sans", "Sans-serif"],
            ]}
            onChange={(font) => updateSettings({ font })}
          />
          <SelectField
            label="Page turning"
            value={s.flow}
            options={[
              ["paginated", "Pages (swipe or tap edges)"],
              ["scrolled", "Continuous scroll"],
            ]}
            onChange={(flow) => updateSettings({ flow })}
          />
        </>
      )}
    </div>
  );
}
