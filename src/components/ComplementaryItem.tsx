import type { AgentMessage } from "../../shared/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { OutputIcon } from "./Icons";
import { CopyMessageButton } from "./CopyMessageButton";
import { formatExactTime } from "../lib/format";

interface ComplementaryItemProps {
  msg: AgentMessage;
}

// The assistant's commentary rendered as a first-class timeline item. Its prose is shown
// inline and always (never gated behind an expand/collapse chevron), so a turn reads as
// commentary -> tool call -> commentary -> ... -> final answer in chronological order,
// instead of the text being a flattened blob or hidden behind a click.
export function ComplementaryItem({ msg }: ComplementaryItemProps) {
  return (
    <div className="complementary-item">
      <div className="complementary-item__header">
        <span className="complementary-item__icon">
          <OutputIcon />
        </span>
        <span className="complementary-item__name">Complementary</span>
        <CopyMessageButton text={msg.text} label="Complementary content" />
        {msg.timestamp && (
          <span className="complementary-item__time">{formatExactTime(msg.timestamp)}</span>
        )}
      </div>
      <div className="complementary-item__body">
        <div className="markdown-body">
          <MarkdownRenderer content={msg.text} />
        </div>
      </div>
    </div>
  );
}
