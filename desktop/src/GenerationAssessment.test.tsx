// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GenerationAssessment } from "./components/common/GenerationAssessment";
afterEach(cleanup);
it("labels format scores without presenting them as writing quality", () => {
  render(<GenerationAssessment tier="high" />);
  expect(screen.getByText("Format score: high")).toBeTruthy();
  expect(screen.getByTitle(/not story correctness, voice or writing quality/)).toBeTruthy();
});
