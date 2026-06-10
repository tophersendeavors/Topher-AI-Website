// The bingeability rubric — distilled from real critic/audience reviews of
// comparable prestige psychological-thriller / closed-world series. This is
// the "research" half of the Audience Read stage, baked in as seed data.
// Bump the version (and re-derive the levers) when researching a new genre.

import type { AudienceReadRubric } from "@toburt/shared";

export const AUDIENCE_READ_RUBRIC: AudienceReadRubric = {
  version: "2026-06-10-psych-thriller-v1",
  genre: "Prestige psychological thriller — closed-world / institutional dread",
  comps: [
    "Severance",
    "The White Lotus",
    "Nine Perfect Strangers",
    "The Resort",
    "Sharp Objects",
  ],
  levers: [
    {
      key: "opening_contract",
      label: "Opening contract / hook",
      bingeLooksLike:
        "Within the first ~10 minutes the pilot promises genre, world, protagonist and stakes, and the inciting question is already live.",
      compSignal: "Pilot craft: the opening scene is the viewer contract — establish the promise fast.",
    },
    {
      key: "mystery_engine",
      label: "Mystery-box engine",
      bingeLooksLike:
        "Concrete questions that demand answers, planted early and hard enough to fuel theorizing between episodes.",
      compSignal: "Severance: many interlocking mysteries + earned cliffhangers drive a theorizing community.",
    },
    {
      key: "dread_atmosphere",
      label: "Dread / off-kilter atmosphere",
      bingeLooksLike:
        "A world that is almost normal but off-kilter enough to feel ominous; tension lives under the surface of calm.",
      compSignal: "The White Lotus: uncanny score + ambient unease keep viewers on edge.",
    },
    {
      key: "character_behavior",
      label: "Character intrigue via behavior",
      bingeLooksLike:
        "Distinct people revealed through action and contradiction, not exposition — while still giving the viewer enough access to latch on.",
      compSignal: "Pilot craft + White Lotus: character shown through behavior; over-withholding loses the audience.",
    },
    {
      key: "forward_momentum",
      label: "Forward momentum (slow-burn, not slow)",
      bingeLooksLike:
        "Something happens; tension escalates scene to scene. Slow-burn builds across a deliberate structure — it does not linger on meaningful glances while nothing moves.",
      compSignal: "Slow-burn post-mortems: 'slow' = nothing happens for three episodes; the #1 drop-off cause.",
    },
    {
      key: "episode_end_pull",
      label: "Episode-end pull",
      bingeLooksLike:
        "An earned button that makes the next episode non-optional and propels straight into it.",
      compSignal: "Severance: a finale that races to a cliffhanger and goes 'go, go, go.'",
    },
    {
      key: "payoff_trust",
      label: "Payoff trust",
      bingeLooksLike:
        "The patience feels like it will be repaid; the build promises a payoff worth the time investment.",
      compSignal: "Nine Perfect Strangers: withheld the reveal too long and the payoff landed as 'silly' — broke trust.",
    },
  ],
  failureModes: [
    "Slow, not slow-burn: lingering on faces and atmosphere while the plot does not move.",
    "Mystery planted too quietly to pull the viewer forward before the atmosphere lulls.",
    "Over-withholding character access — admirable but hard to latch onto.",
    "Late-firing engine: the central mechanism does not act until the back half of the pilot.",
    "Payoff debt: hours of mood with no proportionate return.",
  ],
  sources: [
    "https://www.indiewire.com/criticism/shows/nine-perfect-strangers-hulu-review-nicole-kidman-show-1234658647/",
    "https://www.rogerebert.com/streaming/hulu-nine-perfect-strangers-tv-review-2021",
    "https://time.com/6089080/nine-perfect-strangers-review-hulu/",
    "https://mossylog.org/2025/03/21/the-white-lotus-cleverly-curates-binge-worthy-drama/",
    "https://www.gamesradar.com/severance-ending-explained-season-1-cliffhanger/",
    "https://filmschoolrejects.com/when-is-slow-burn-television-worth-it/",
    "https://www.hollywoodreporter.com/tv/tv-features/slow-burn-hit-tv-gone-1236263233/",
    "https://www.curtisbrowncreative.co.uk/blog/how-to-write-a-great-opening-to-a-tv-drama-pilot",
  ],
};
