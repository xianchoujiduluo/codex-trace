import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// jsdom does not implement element scrolling.
Element.prototype.scrollTo = vi.fn();
