import { describe, expect, it } from "vitest";
import { confidentMatch, findMatches, parseSpokenItem } from "@/lib/catalog-match";

const products = [
  { id: "atta5", name: "Aashirvaad Whole Wheat Atta", size: "5 kg", nameLocal: "ಆಶೀರ್ವಾದ್ ಗೋಧಿ ಹಿಟ್ಟು", aliases: ["atta", "godhi hittu", "aashirvaad"] },
  { id: "atta10", name: "Aashirvaad Whole Wheat Atta", size: "10 kg", nameLocal: null, aliases: ["atta", "aashirvaad"] },
  { id: "maggi", name: "Maggi 2-Minute Noodles", size: "70 g", nameLocal: "मैगी", aliases: ["maggi", "noodles"] },
  { id: "butter", name: "Amul Butter", size: "100 g", nameLocal: null, aliases: ["butter", "amul"] },
  { id: "milk", name: "Nandini Toned Milk", size: "500 ml", nameLocal: "ನಂದಿನಿ ಹಾಲು", aliases: ["milk", "haalu", "nandini"] },
];

describe("catalog matching", () => {
  it("matches brand names, aliases and local script", () => {
    expect(confidentMatch("maggi", products)?.id).toBe("maggi");
    expect(confidentMatch("amul butter", products)?.id).toBe("butter");
    expect(confidentMatch("nandini haalu", products)?.id).toBe("milk");
    expect(confidentMatch("मैगी", products)?.id).toBe("maggi");
  });

  it("tolerates small misspellings from speech-to-text", () => {
    expect(findMatches("aashirwad atta", products)[0].product.name).toContain("Aashirvaad");
  });

  it("uses the spoken pack size to pick between variants", () => {
    expect(confidentMatch("aashirvaad atta 10 kg", products)?.id).toBe("atta10");
    expect(confidentMatch("atta 5kg", products)?.id).toBe("atta5");
  });

  it("refuses to guess when two products tie", () => {
    expect(confidentMatch("atta", products)).toBeNull();
  });

  it("does not let a brand alias match a different product from that brand", () => {
    const ghee = [{ id: "ghee", name: "Amul Pure Ghee", size: "1 L", nameLocal: null, aliases: ["ghee", "amul", "amul ghee"] }];
    expect(confidentMatch("amul butter", ghee)).toBeNull();
    expect(confidentMatch("amul ghee", ghee)?.id).toBe("ghee");
  });

  it("returns nothing for unknown items", () => {
    expect(confidentMatch("iphone charger", products)).toBeNull();
  });
});

describe("parseSpokenItem", () => {
  it("parses the PRD example", () => {
    expect(parseSpokenItem("Aashirvaad atta 5 kilo 260 rupees")).toEqual({ name: "Aashirvaad atta", size: "5 kg", price: 260 });
  });
  it("handles ₹ and a missing size", () => {
    expect(parseSpokenItem("good day biscuit ₹30")).toEqual({ name: "Good day biscuit", size: null, price: 30 });
  });
  it("treats a trailing number as the price", () => {
    expect(parseSpokenItem("amul butter 100 g 58")).toEqual({ name: "Amul butter", size: "100 g", price: 58 });
  });
  it("leaves price null when not said", () => {
    expect(parseSpokenItem("tata salt 1 kg").price).toBeNull();
  });
});
