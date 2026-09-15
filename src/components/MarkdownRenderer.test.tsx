import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ children, language }: { children: string; language: string }) => (
    <pre data-language={language}>{children}</pre>
  ),
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }));

describe("MarkdownRenderer", () => {
  it("renders plain markdown text", () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders markdown bold", () => {
    const { container } = render(<MarkdownRenderer content="**bold text**" />);
    expect(container.querySelector("strong")).toBeInTheDocument();
  });

  it("detects bare JSON object and renders via SyntaxHighlighter", () => {
    const { container } = render(<MarkdownRenderer content='{"key":"value","num":42}' />);
    expect(container.querySelector('[data-language="json"]')).toBeInTheDocument();
    expect(container.textContent).toContain('"key"');
  });

  it("detects bare JSON array and renders via SyntaxHighlighter", () => {
    const { container } = render(<MarkdownRenderer content="[1,2,3]" />);
    expect(container.querySelector('[data-language="json"]')).toBeInTheDocument();
  });

  it("formats bare JSON with pretty-printing", () => {
    const { container } = render(<MarkdownRenderer content='{"a":1,"b":2}' />);
    expect(container.textContent).toMatch(/\n/);
  });

  it("does not treat invalid JSON starting with { as a code block", () => {
    const { container } = render(<MarkdownRenderer content="{not valid json}" />);
    expect(container.querySelector("[data-language]")).not.toBeInTheDocument();
  });

  it("does not treat plain text as JSON", () => {
    const { container } = render(<MarkdownRenderer content="just text" />);
    expect(container.querySelector("[data-language]")).not.toBeInTheDocument();
  });

  it("renders fenced code block with syntax highlighting via ReactMarkdown", () => {
    const { container } = render(<MarkdownRenderer content={"```js\nconsole.log('hi')\n```"} />);
    expect(container.querySelector('[data-language="js"]')).toBeInTheDocument();
  });

  it("folds a single newline into the paragraph by default", () => {
    const { container } = render(<MarkdownRenderer content={"line one\nline two"} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("keeps a single newline as a break when breaks is set", () => {
    const { container } = render(<MarkdownRenderer content={"line one\nline two"} breaks />);
    expect(container.querySelector("br")).toBeInTheDocument();
  });

  it("still renders markdown syntax when breaks is set", () => {
    const { container } = render(<MarkdownRenderer content={"# Heading\n\n**bold**"} breaks />);
    expect(container.querySelector("h1")).toBeInTheDocument();
    expect(container.querySelector("strong")).toBeInTheDocument();
  });
});
