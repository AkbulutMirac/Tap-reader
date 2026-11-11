import { Button, Card } from "@heroui/react";
import { useState } from "react";
import { db, type SavedWord } from "../db";
import { answerCard, isDue } from "./review";
import { Emphasize } from "./Emphasize";

/** Flashcards: word + its sentence first, translation after "Show". */
export function ReviewPanel({ words }: { words: SavedWord[] }) {
  // The queue is fixed when the session starts, so cards don't jump around while answering.
  const [session, setSession] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const due = words.filter((w) => isDue(w));

  if (!session) {
    const next = words.filter((w) => !isDue(w)).sort((a, b) => a.dueAt - b.dueAt)[0];
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        {due.length ? (
          <>
            <p className="text-lg">
              <b>{due.length}</b> {due.length === 1 ? "word is" : "words are"} ready to review.
            </p>
            <Button
              onPress={() => {
                setSession(due.sort((a, b) => a.dueAt - b.dueAt).map((w) => w.word));
                setDone(0);
                setRevealed(false);
              }}
            >
              Start review
            </Button>
          </>
        ) : (
          <p className="text-muted">
            {words.length ? "Nothing to review right now." : "Save words while reading to review them here."}
            {next && <> Next review: {new Date(next.dueAt).toLocaleDateString()}.</>}
          </p>
        )}
      </div>
    );
  }

  const current = words.find((w) => w.word === session[0]);
  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-lg">Done! You reviewed {done} {done === 1 ? "card" : "cards"}.</p>
        <Button variant="secondary" onPress={() => setSession(null)}>
          Back
        </Button>
      </div>
    );
  }

  const answer = async (knew: boolean) => {
    await db.words.update(current.word, answerCard(current, knew));
    setDone((d) => d + 1);
    setRevealed(false);
    // Forgotten cards go to the end of this session's queue.
    setSession((queue) => {
      const rest = (queue ?? []).slice(1);
      return knew ? rest : [...rest, current.word];
    });
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-4">
      <p className="text-center text-sm text-muted">{session.length} left</p>
      <Card className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-3xl font-semibold">{current.word}</div>
        {current.sentence && (
          <p className="text-muted">
            <Emphasize text={current.sentence} word={current.word} />
          </p>
        )}
        {revealed && (
          <div className="mt-2 border-t border-separator pt-3 text-2xl font-semibold text-accent">
            {current.translation || "—"}
            {current.lemma && <div className="text-sm font-normal text-muted">base form: {current.lemma}</div>}
          </div>
        )}
      </Card>
      {revealed ? (
        <div className="grid grid-cols-2 gap-3">
          <Button fullWidth variant="danger-soft" size="lg" onPress={() => answer(false)}>
            Again
          </Button>
          <Button fullWidth size="lg" onPress={() => answer(true)}>
            I knew it
          </Button>
        </div>
      ) : (
        <Button fullWidth size="lg" variant="secondary" onPress={() => setRevealed(true)}>
          Show meaning
        </Button>
      )}
      <Button variant="ghost" size="sm" onPress={() => setSession(null)}>
        End review
      </Button>
    </div>
  );
}
