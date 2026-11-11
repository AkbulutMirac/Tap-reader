import { Button, Popover } from "@heroui/react";
import { useEffect, useState } from "react";
import { db } from "../db";
import { useSettings } from "../settings";
import { lookup, lookupOnlineCached } from "../translate/lookup";
import { normalizeWord } from "../translate/normalize";
import type { LookupResult } from "../translate/types";

export interface PopupTarget {
  /** Changes on every tap, so the popover re-anchors. */
  id: number;
  word: string;
  sentence: string;
  /** Word box in top-level viewport coordinates. */
  rect: DOMRect;
  bookTitle?: string;
  location?: string;
  /** A selected phrase instead of one tapped word. */
  phrase?: boolean;
}

interface WordPopupProps {
  target: PopupTarget | null;
  onClose: () => void;
}

type LookupState =
  { status: "loading" } | { status: "done"; result: LookupResult } | { status: "error"; message: string };

/**
 * Highlights the tapped word, looks it up, then opens a popover on it.
 * The popover opens only once its content is final, so it is placed at its real size.
 * Taps outside the popup and the reader close it.
 */
export function WordPopup({ target, onClose }: WordPopupProps) {
  const { targetLang } = useSettings();
  // Tagged with the tap id so a new tap never shows the previous word's result.
  const [lookupState, setState] = useState<LookupState & { id: number }>({ id: -1, status: "loading" });
  const state: LookupState = lookupState.id === target?.id ? lookupState : { status: "loading" };
  const [revision, setRevision] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  useEffect(() => setMoreFailed(false), [target]);

  useEffect(() => {
    if (!target) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.("[data-word-popup], [data-reader]")) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [target, onClose]);

  useEffect(() => {
    if (!target) return;
    const ac = new AbortController();
    const id = target.id;
    lookup(target.word, targetLang, ac.signal).then(
      (result) => setState({ id, status: "done", result }),
      (err: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          id,
          status: "error",
          message: navigator.onLine
            ? `No translation found (${(err as Error)?.message ?? err}).`
            : "You're offline and this word isn't saved offline yet.",
        });
      },
    );
    return () => ac.abort();
  }, [target, targetLang]);

  if (!target) return null;
  const { rect } = target;

  const showMore = async () => {
    if (state.status !== "done") return;
    setMoreLoading(true);
    try {
      const online = await lookupOnlineCached(normalizeWord(target.word), targetLang);
      setState({ id: target.id, status: "done", result: { ...online, lemma: online.lemma ?? state.result.lemma } });
      setRevision((r) => r + 1); // re-open so the popover is placed at its new size
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreLoading(false);
    }
  };

  return (
    <Popover
      key={`${target.id}:${revision}`}
      isOpen={state.status !== "loading"}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The highlight box over the tapped word doubles as the popover's anchor. */}
      <Popover.Trigger
        aria-hidden
        tabIndex={-1}
        className={`word-mark${state.status === "loading" ? " is-loading" : ""}`}
        style={{ left: rect.left - 2, top: rect.top - 1, width: rect.width + 4, height: rect.height + 2 }}
      />
      {state.status !== "loading" && (
        <Popover.Content
          isNonModal
          placement="top"
          offset={8}
          containerPadding={8}
          // Column layout so the dialog shrinks to the popover's max height (set by React Aria
          // from the free space) and scrolls, instead of spilling out of the card.
          className="flex w-[min(22rem,calc(100vw-16px))] flex-col"
          data-word-popup
        >
          <Popover.Arrow />
          <Popover.Dialog
            aria-label={`Translation of ${target.word}`}
            className="max-h-[45dvh] min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4"
          >
            <WordCard target={target} state={state} />
            {state.status === "done" && state.result.source === "offline" && !moreFailed && (
              <Button size="sm" variant="ghost" className="mt-1 -ml-2" isPending={moreLoading} onPress={showMore}>
                More meanings (online)
              </Button>
            )}
          </Popover.Dialog>
        </Popover.Content>
      )}
    </Popover>
  );
}

function WordCard({ target, state }: { target: PopupTarget; state: Exclude<LookupState, { status: "loading" }> }) {
  const key = normalizeWord(target.word);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    db.words.get(key).then(
      (w) => setSaved(!!w),
      () => setSaved(false),
    );
  }, [key]);

  const toggleSave = async () => {
    if (saved) {
      await db.words.delete(key);
      setSaved(false);
      return;
    }
    if (state.status !== "done") return;
    const now = Date.now();
    await db.words.put({
      word: key,
      lemma: state.result.lemma,
      translation: state.result.translation,
      sentence: target.sentence,
      bookTitle: target.bookTitle,
      location: target.location,
      savedAt: now,
      box: 0,
      dueAt: now,
    });
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-semibold break-words ${target.phrase ? "line-clamp-3 text-sm" : "text-base"}`}>
            {target.word}
          </div>
          {state.status === "done" && state.result.lemma && (
            <div className="text-xs text-muted">base form: {state.result.lemma}</div>
          )}
        </div>
        {(state.status === "done" || saved) && (
          <Button
            size="sm"
            variant={saved ? "primary" : "secondary"}
            onPress={toggleSave}
            aria-label={saved ? "Remove from word list" : "Save to word list"}
          >
            {saved ? "★ Saved" : "☆ Save"}
          </Button>
        )}
      </div>

      {state.status === "error" ? (
        <div className="text-danger">{state.message}</div>
      ) : (
        <ResultBody result={state.result} />
      )}
    </div>
  );
}

function ResultBody({ result }: { result: LookupResult }) {
  return (
    <>
      {result.translation ? (
        <div className="text-xl font-semibold text-accent break-words">{result.translation}</div>
      ) : (
        <div className="text-muted">No Turkish translation saved offline.</div>
      )}

      {result.senses.length > 0 && (
        <ul className="flex flex-col gap-1">
          {result.senses.slice(0, 3).map((s) => (
            <li key={s.pos}>
              <span className="mr-1.5 text-xs uppercase tracking-wide text-muted">{s.pos}</span>
              {s.terms.join(", ")}
            </li>
          ))}
        </ul>
      )}

      {result.definitions.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-separator pt-2">
          {result.definitions.slice(0, 2).map((d, i) => (
            // Phones show one definition to keep the popup small.
            <div key={i} className={i > 0 ? "max-sm:hidden" : undefined}>
              <span className="mr-1.5 text-xs italic text-muted">{d.pos}</span>
              {d.gloss}
              {d.example && <div className="mt-0.5 italic text-muted">“{d.example}”</div>}
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-muted">{result.source === "offline" ? "Offline dictionary" : "Online"}</div>
    </>
  );
}
