import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { syntaxHighlighterStyle } from "../lib/theme";
import { formatJson } from "../lib/format";

function isPureJson(s: string): boolean {
  const t = s.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

const renderCode: NonNullable<Components["code"]> = ({ className, children }) => {
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");
  if (!lang) {
    return <code className={className}>{children}</code>;
  }
  return (
    <SyntaxHighlighter
      language={lang}
      style={oneDark}
      PreTag="div"
      customStyle={syntaxHighlighterStyle}
    >
      {code}
    </SyntaxHighlighter>
  );
};

const markdownComponents: Components = { code: renderCode };

export function MarkdownRenderer({ content }: { content: string }) {
  if (isPureJson(content)) {
    return (
      <SyntaxHighlighter
        language="json"
        style={oneDark}
        PreTag="div"
        customStyle={syntaxHighlighterStyle}
      >
        {formatJson(content)}
      </SyntaxHighlighter>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
