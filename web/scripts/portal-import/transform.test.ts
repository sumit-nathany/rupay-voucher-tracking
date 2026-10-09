import { describe, expect, it } from "vitest";
import { cleanText, isPickOne, mapFrequency, transformCard, type PortalDeal } from "./transform";

const deal = (o: Partial<PortalDeal>): PortalDeal => ({
  servicename: "Spa Services",
  spname: "Spa A",
  productname: "Massage",
  cvalidity: "Quarterly",
  complimentaryCount: "1",
  netrate: "1500.0",
  startdate: "2025-01-01T00:00:00",
  enddate: "2026-12-31T00:00:00",
  productid: "1",
  ...o,
});

describe("helpers", () => {
  it("cleans html and entities", () => {
    expect(cleanText("<p>Save&nbsp;on  Domestic &amp; Intl</p>\n")).toBe("Save on Domestic & Intl");
  });
  it("maps validity", () => {
    expect(mapFrequency("Yearly")).toBe("Annual");
    expect(mapFrequency("Half-Yearly")).toBe("6 months");
    expect(mapFrequency("Life Time")).toBeNull();
  });
  it("detects pick-one wording even with markup between the words", () => {
    expect(isPickOne({ id: 1, servicename: "Spa", ddescription: "<li>Choose &amp; redeem any&nbsp;<strong>one</strong>&nbsp;of the below</li>" })).toBe(true);
    expect(isPickOne({ id: 1, servicename: "Shop", ddescription: "<li>Unlock offers</li>" })).toBe(false);
  });
});

describe("transformCard", () => {
  const pick = { id: 35, servicename: "Spa Services", ddescription: "Choose & redeem any <strong>one</strong> of the below" };
  const shop = { id: 53, servicename: "Online Shopping", ddescription: "Shop the latest" };
  const gym = { id: 36, servicename: "Gym Access", ddescription: "redeem any one" };

  it("pick-one category with several offers becomes one benefit with options", () => {
    const { benefits } = transformCard([pick], new Map([["35", [
      deal({ spname: "Spa B", productname: "Thai", netrate: "2700.0", productid: "2", startdate: "2019-09-11T00:00:00" }),
      deal({ spname: "Spa A", productname: "Swedish", netrate: "1850.0" }),
    ]]]));
    expect(benefits).toHaveLength(1);
    expect(benefits[0]).toMatchObject({
      benefitType: "Spa Services",
      benefitProvider: null,
      exactBenefit: "Any one of 2 offers",
      frequency: "Quarterly",
      instanceCount: 1,
      defaultCashValue: 2700,
      effectiveFrom: "2019-09-11",
      effectiveTo: null,
    });
    expect(benefits[0].options.map((o) => o.provider)).toEqual(["Spa A", "Spa B"]);
    expect(benefits[0].options[1]).toEqual({ provider: "Spa B", offerName: "Thai", cashValue: 2700, portalOfferId: 2 });
  });

  it("other categories keep one benefit per offer", () => {
    const { benefits } = transformCard([shop], new Map([["53", [
      deal({ servicename: "Online Shopping", spname: "Myntra", productname: "Rs 500 off", netrate: "500" }),
      deal({ servicename: "Online Shopping", spname: "Decathlon", productname: "Decathlon - Quaterly", netrate: "500" }),
    ]]]));
    expect(benefits.map((b) => [b.benefitProvider, b.options.length])).toEqual([["Myntra", 0], ["Decathlon", 0]]);
  });

  it("pick-one with a single offer stays an ordinary benefit", () => {
    const { benefits } = transformCard([gym], new Map([["36", [deal({ servicename: "Gym Access", spname: "Cult.fit" })]]]));
    expect(benefits[0]).toMatchObject({ benefitProvider: "Cult.fit", options: [] });
  });

  it("skips unknown validity with a warning", () => {
    const { benefits, warnings } = transformCard([shop], new Map([["53", [deal({ cvalidity: "Life Time" })]]]));
    expect(benefits).toHaveLength(0);
    expect(warnings[0]).toMatch(/unknown validity/);
  });
});
