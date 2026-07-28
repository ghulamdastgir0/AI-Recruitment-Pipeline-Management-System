import { Fragment, type ReactNode } from "react";

type LineType = "ol" | "ul" | "p";

interface Block {
  type: LineType;
  items: string[];
}

function classifyLine(line: string): { type: LineType; text: string } {
  const ordered = /^\d+\.\s+(.*)$/.exec(line);
  if (ordered) return { type: "ol", text: ordered[1] };
  const bulleted = /^[-*]\s+(.*)$/.exec(line);
  if (bulleted) return { type: "ul", text: bulleted[1] };
  return { type: "p", text: line };
}

/** Groups raw lines into paragraph/list blocks — blank lines are separators, not content. */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const { type, text } = classifyLine(line);
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) {
      last.items.push(text);
    } else {
      blocks.push({ type, items: [text] });
    }
  }
  return blocks;
}

/** Renders `**bold**` spans as React nodes (never HTML) — safe for untrusted text either way. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    return match ? <strong key={index}>{match[1]}</strong> : <Fragment key={index}>{part}</Fragment>;
  });
}

/**
 * Lightweight, dependency-free formatter for assistant replies: bold text,
 * numbered/bulleted lists, and line breaks. The assistant's system prompt
 * doesn't constrain its output format, so replies routinely come back as
 * markdown-ish text ("**Job title**", "1. ..."); rendering it as a single
 * unstyled text node (the previous behavior) collapsed all of that into one
 * unreadable run-on paragraph. Not a full markdown parser — just what the
 * assistant actually produces — and renders via React elements only, so
 * there's no dangerouslySetInnerHTML/XSS surface regardless of source.
 */
export function FormattedMessage({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        if (block.type === "ol") {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {block.items.map((item, itemIndex) => (
              <Fragment key={itemIndex}>
                {itemIndex > 0 && <br />}
                {renderInline(item)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
