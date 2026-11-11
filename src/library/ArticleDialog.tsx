import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { useState } from "react";
import { navigate } from "../router";
import { importArticle } from "./article";

/** Paste a link → the page's article text opens in the reader. */
export default function ArticleDialog({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const book = await importArticle(url);
      onClose();
      navigate({ name: "read", bookId: book.id });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Open a web article</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <form
              id="article-form"
              onSubmit={(e) => {
                e.preventDefault();
                void open();
              }}
            >
              <TextField value={url} onChange={setUrl} type="url" autoFocus isInvalid={!!error}>
                <Label>Link</Label>
                <Input placeholder="https://…" inputMode="url" />
              </TextField>
            </form>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <p className="mt-2 text-xs text-muted">
              The article text is saved in your library, so you can read it later without internet.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="article-form" isPending={busy}>
              Open
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
