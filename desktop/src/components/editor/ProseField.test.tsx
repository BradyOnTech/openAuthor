// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ProseField, type ProseFieldElement } from "./ProseField";

afterEach(cleanup);

function Harness({ initial, onText, stateKey = "test:scene" }: { initial: string; onText?: (value: string) => void; stateKey?: string }) {
  const [value, setValue] = useState(initial);
  return <>
    <ProseField value={value} stateKey={stateKey} ariaLabel="Scene prose" placeholder="Begin writing..." className="scene-editor__body" onChange={next => { setValue(next); onText?.(next); }} />
    <button onClick={() => setValue("Replaced from outside.")}>Reload</button>
    <button onClick={() => setValue(current => current + "\n")}>Normalise</button>
    <output>{value}</output>
  </>;
}

const field = () => screen.getByRole("textbox", { name: "Scene prose" }) as ProseFieldElement;

describe("prose field", () => {
  it("presents the scene text as an editable field with value and selection", () => {
    render(<Harness initial={"Mara waits.\n\nIvo does not."} stateKey="a" />);
    expect(field().value).toBe("Mara waits.\n\nIvo does not.");
    expect(screen.getByPlaceholderText("Begin writing...")).toBe(field());
    field().setSelectionRange(5, 10, "backward");
    expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([5, 10, "backward"]);
    field().setSelectionRange(3, 999);
    expect([field().selectionStart, field().selectionEnd]).toEqual([3, 26]);
  });

  it("reports the author's edits and applies text from outside without echoing it back", () => {
    const edits = vi.fn();
    render(<Harness initial="Mara waits." onText={edits} stateKey="b" />);
    fireEvent.change(field(), { target: { value: "Mara runs." } });
    expect(edits).toHaveBeenLastCalledWith("Mara runs.");
    expect(screen.getByRole("status").textContent).toBe("Mara runs.");
    act(() => field().replaceRange(5, 9, "walks"));
    expect(edits).toHaveBeenLastCalledWith("Mara walks.");
    expect(field().selectionStart).toBe(10);
    edits.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(field().value).toBe("Replaced from outside.");
    expect(edits).not.toHaveBeenCalled();
  });

  it("keeps a scene's text, caret and undo history across a remount, but not for different text", () => {
    const first = render(<Harness initial="Mara waits." stateKey="c" />);
    field().replaceRange(11, 11, " Ivo watches.");
    field().setSelectionRange(4, 4);
    first.unmount();
    render(<Harness initial="Mara waits. Ivo watches." stateKey="c" />);
    expect(field().selectionStart).toBe(4);
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true });
    expect(field().value).toBe("Mara waits.");
    cleanup();
    render(<Harness initial="A different saved scene." stateKey="c" />);
    expect(field().value).toBe("A different saved scene.");
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true });
    expect(field().value).toBe("A different saved scene.");
  });

  it("keeps undo exact when saving adds a trailing newline, and starts a new history when other text arrives", () => {
    render(<Harness initial="Mara waits by the gate." stateKey="d" />);
    act(() => field().replaceRange(5, 10, "runs"));
    expect(field().value).toBe("Mara runs by the gate.");
    fireEvent.click(screen.getByRole("button", { name: "Normalise" }));
    expect(field().value).toBe("Mara runs by the gate.\n");
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true });
    expect(field().value).toBe("Mara waits by the gate.\n");
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
    expect(field().value).toBe("Mara runs by the gate.\n");

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(field().value).toBe("Replaced from outside.");
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true });
    expect(field().value).toBe("Replaced from outside.");
    act(() => field().replaceRange(0, 8, "Rewritten"));
    fireEvent.keyDown(field(), { key: "z", code: "KeyZ", ctrlKey: true });
    expect(field().value).toBe("Replaced from outside.");
  });
});
