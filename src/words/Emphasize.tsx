/** `text` with `word` (and its inflections, e.g. bank → banks) in bold. */
export function Emphasize({ text, word }: { text: string; word: string }) {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\p{L}*)`, "iu");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <b key={i} className="text-foreground">
            {p}
          </b>
        ) : (
          p
        ),
      )}
    </>
  );
}
