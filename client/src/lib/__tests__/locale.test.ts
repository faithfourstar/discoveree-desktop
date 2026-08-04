import { describe, expect, it } from "vitest";
import {
  detectDisplayLocale,
  resolveDisplayLocale,
  toDisplayEnglish,
} from "../locale";

/**
 * The display-locale seam (build brief "Display locale"): copy is authored
 * in British English; the dictionary transform renders en-US. Data is never
 * transformed — passthrough is part of the contract.
 */

describe("toDisplayEnglish", () => {
  it("Given en-GB, When transforming, Then authored copy returns verbatim", () => {
    const copy = "Your licence expires in a fortnight — organise a renewal.";
    expect(toDisplayEnglish(copy, "en-GB")).toBe(copy);
  });

  it("Given en-US, When copy contains table spellings, Then they invert GB→US", () => {
    expect(
      toDisplayEnglish(
        "Organise and prioritise your colour behaviour at the help centre.",
        "en-US",
      ),
    ).toBe("Organize and prioritize your color behavior at the help center.");
  });

  it("Given en-US, When copy says licence (noun), Then it renders license", () => {
    expect(toDisplayEnglish("Buy a licence ↗", "en-US")).toBe(
      "Buy a license ↗",
    );
    expect(toDisplayEnglish("Licence to 14 Mar 2027", "en-US")).toBe(
      "License to 14 Mar 2027",
    );
    expect(
      toDisplayEnglish("Reading only · licence expired", "en-US"),
    ).toBe("Reading only · license expired");
  });

  it("Given en-US, When copy uses licensed/licensing (shared spellings), Then they pass unchanged", () => {
    expect(toDisplayEnglish("Licensed to faith@discoveree.com", "en-US")).toBe(
      "Licensed to faith@discoveree.com",
    );
    expect(toDisplayEnglish("licensing terms", "en-US")).toBe(
      "licensing terms",
    );
  });

  it("Given en-US, When copy uses the fortnight idioms, Then they become week phrasing", () => {
    expect(toDisplayEnglish("fortnightly", "en-US")).toBe("every 2 weeks");
    expect(toDisplayEnglish("Checked once a fortnight.", "en-US")).toBe(
      "Checked once every 2 weeks.",
    );
    expect(toDisplayEnglish("Back in a fortnight.", "en-US")).toBe(
      "Back in two weeks.",
    );
  });

  it("Given en-US, When copy uses curated idioms, Then meaning-preserving swaps apply", () => {
    expect(
      toDisplayEnglish(
        "Site crawling and changelog watching carry on.",
        "en-US",
      ),
    ).toBe("Site crawling and changelog watching continue.");
    expect(toDisplayEnglish("Cataloguing their features…", "en-US")).toBe(
      "Cataloging their features…",
    );
    expect(
      toDisplayEnglish("Found in your organisation’s context", "en-US"),
    ).toBe("Found in your organization’s context");
  });

  it("Given en-US, When words merely contain dictionary letters, Then they are untouched", () => {
    // No suffix rules: -our/-re/-ise lookalikes never match.
    expect(
      toDisplayEnglish(
        "Your four-hour tour of enterprise surprise analysis parameters",
        "en-US",
      ),
    ).toBe("Your four-hour tour of enterprise surprise analysis parameters");
    // "analyses" is deliberately ambiguous (noun plural) — untransformed.
    expect(toDisplayEnglish("Both analyses agree.", "en-US")).toBe(
      "Both analyses agree.",
    );
  });

  it("Given en-US, When copy is capitalised, Then case is preserved", () => {
    expect(toDisplayEnglish("Colour discipline", "en-US")).toBe(
      "Color discipline",
    );
    expect(toDisplayEnglish("LICENCE", "en-US")).toBe("LICENSE");
  });

  it("Given data-shaped strings (verbatims, names), When they reach the transform, Then callers must not send them — passthrough is en-GB's job", () => {
    // The boundary is enforced at call sites (data never flows through t()),
    // and en-GB rendering is byte-identical for everything:
    const verbatim = "“We prioritise the colour features” — G2 review";
    expect(toDisplayEnglish(verbatim, "en-GB")).toBe(verbatim);
  });
});

describe("detectDisplayLocale", () => {
  it("resolves UK/IE/Commonwealth regions to en-GB", () => {
    for (const tag of ["en-GB", "en-IE", "en-AU", "en-NZ", "en-ZA", "en-IN"]) {
      expect(detectDisplayLocale([tag])).toBe("en-GB");
    }
    // Non-English language, British region: the machine lives there.
    expect(detectDisplayLocale(["cy-GB"])).toBe("en-GB");
  });

  it("resolves everything else — including bare 'en' — to en-US", () => {
    for (const tags of [["en-US"], ["en"], ["de-DE"], ["fr-FR"], []]) {
      expect(detectDisplayLocale(tags)).toBe("en-US");
    }
  });
});

describe("resolveDisplayLocale", () => {
  it("auto follows detection; explicit settings win", () => {
    expect(resolveDisplayLocale("auto", "en-GB")).toBe("en-GB");
    expect(resolveDisplayLocale("auto", "en-US")).toBe("en-US");
    expect(resolveDisplayLocale("en-GB", "en-US")).toBe("en-GB");
    expect(resolveDisplayLocale("en-US", "en-GB")).toBe("en-US");
  });
});
