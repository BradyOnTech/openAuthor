// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { proseFromHtml } from "./pastedProse";

describe("pasting formatted prose", () => {
  it("keeps italics and bold from a word processor as Markdown emphasis", () => {
    expect(proseFromHtml("<p>She did <i>not</i> turn. <b>Never.</b></p><p><em>Nobody rings that</em>, he said.</p>"))
      .toBe("She did *not* turn. **Never.**\n\n*Nobody rings that*, he said.");
  });

  it("reads emphasis given as inline styles and joins split runs into one phrase", () => {
    expect(proseFromHtml('<p><span style="font-style:italic">Nobody </span><span style="font-style: italic">rings</span><span> that.</span></p>'))
      .toBe("*Nobody rings* that.");
    expect(proseFromHtml('<b style="font-weight:normal"><p><span style="font-weight:700">Loud</span> and <span style="font-style:italic">quiet</span>.</p></b>'))
      .toBe("**Loud** and *quiet*.");
  });

  it("keeps line breaks and ignores styles, scripts and all other formatting", () => {
    expect(proseFromHtml('<style>p{color:red}</style><p style="color:red">One<br><u>two</u> <i>three</i></p>')).toBe("One\ntwo *three*");
  });

  it("leaves unformatted HTML to the plain-text clipboard", () => {
    expect(proseFromHtml("<p>Plain words only.</p>")).toBeNull();
    expect(proseFromHtml("<p><i>   </i>Still plain.</p>")).toBeNull();
  });
});
