# Game Lookups And Filtered Discovery Regression Runs

## Metadata

- Run 1 source: `docs/chat-prompt-evals.md`
- Run 2 environment: `https://www.publisheriq.app`
- Run 2 execution mode: authenticated production `POST /api/chat/stream`
- Run 2 date: March 19, 2026
- Run 3 environment: `https://www.publisheriq.app`
- Run 3 execution mode: authenticated production `POST /api/chat/stream`
- Run 3 date: March 19, 2026
- Run 3 prompts rerun: `#2`, `#219`
- Prompts: `#2`, `#10`, `#21`, `#138`, `#141`, `#219`, `#242`

## Summary

| Prompt | Query | Run 1 | Run 2 | Outcome |
|---|---|---|---|---|
| `#2` | `free metroidvania games` | Sparse 3-row answer with no context | Still 3 rows, but adds release date, review counts, developer, publisher | Fixed in Run 3: live now returns all 4 current matches and explicitly says the catalog is sparse |
| `#10` | `tell me about Hades II` | Called a released game "upcoming" | Correctly states `Released` and adds price, reviews, Steam Deck, platforms | Fixed |
| `#21` | `Show me all the DLC for Elden Ring` | Mixed in unrelated/base titles | Routes to `DlcRelations` and explicitly reports incomplete DLC metadata | Fixed |
| `#138` | `Games currently on sale` | Discount dump dominated by low-signal shovelware | Returns popular discounted titles ranked by review volume | Fixed |
| `#141` | `Highly rated games under $10 released in the past year` | Tiny-sample 100% titles dominated list | Returns high-signal games with real review volume and richer fields | Fixed |
| `#219` | `Games under $5 with overwhelmingly positive reviews` | Violated hard constraint in a second section | All listed titles stay under `$5` and are high-signal | Fixed in Run 3: live now canonicalizes the shared `Discovery` query to `GameCatalog` and preserves the hard constraint |
| `#242` | `Premium games over $40 with great reviews` | False zero-result answer | Returns relevant premium games over `$40` with strong review counts | Fixed |

## Prompt #2

- Prompt: `free metroidvania games`
- Run 1 score/verdict: `9/10` / `Strong`
- Run 1 tools: `search_games`
- Run 1 timing: `total 4696ms | llm 3944ms | tools 511ms | iterations 2`
- Run 2 status/timing: `success` / `200` / `12453ms`
- Run 2 tools: `search_games`
- Run 3 status/timing: `success` / `200` / `23254ms`
- Run 3 tools: `search_games`
- Assessment: fixed in Run 3. A direct read-only database query confirms there are exactly 4 released, non-delisted, free `Metroidvania` matches in the current catalog, and live chat now returns all 4 while explicitly labeling the result set as sparse.

### Database Validation

- Read-only database check on March 19, 2026 found exactly 4 matching apps for released, non-delisted, free `Metroidvania` games.
- Matching appids: `286100` `You Have to Win the Game`, `1761380` `Otherworld Legends 战魂铭人`, `1027480` `Birth of a Hunter`, `710130` `(Hidden Dragon Legend: Shadow Trace)`.

### Run 1 Output

```md
Here are some free Metroidvania games available on Steam:

| Game | Review Score |
|------|--------------|
| [You Have to Win the Game](game:286100) | 92.9% |
| [Birth of a Hunter](game:1027480) | 63.2% |
| [(Hidden Dragon Legend: Shadow Trace)](game:710130) | 66% |

Feel free to check them out!
```

### Run 2 Output

```md
Here are some free Metroidvania games available on Steam:

| Game | Release Date | Total Reviews | Review Percentage | Developer | Publisher |
|------|--------------|---------------|-------------------|-----------|-----------|
| [You Have to Win the Game](game:286100) | May 6, 2014 | 5,675 | 92.9% | [Minor Key Games](/developers/2614) | [Minor Key Games](/publishers/2585) |
| [Birth of a Hunter](game:1027480) | March 4, 2019 | 19 | 63.2% | [Alex Tritt](/developers/325069) | [Alex Tritt](/publishers/309114) |
| [(Hidden Dragon Legend: Shadow Trace)](game:710130) | March 13, 2018 | 0 | 66% | N/A | N/A |

These games offer a variety of experiences within the Metroidvania genre, with "You Have to Win the Game" being particularly well-reviewed. Enjoy exploring!
```

### Run 2 Tool Calls

```json
[
  {
    "name": "search_games",
    "arguments": {
      "tags": [
        "Metroidvania"
      ],
      "is_free": true,
      "order_by": "reviews"
    },
    "executionMs": 691,
    "success": true,
    "result_summary": "3 results"
  }
]
```

### Run 3 Output

```md
Here are some free Metroidvania games available on Steam:

| Game | Release Date | Total Reviews | Review Percentage | Developer | Publisher |
|------|--------------|---------------|-------------------|-----------|-----------|
| [You Have to Win the Game](game:286100) | May 6, 2014 | 5,675 | 92.9% | [Minor Key Games](/developers/2614) | [Minor Key Games](/publishers/2585) |
| [Otherworld Legends 战魂铭人](game:1761380) | October 30, 2024 | 1,287 | 62.3% | [ChillyRoom](/developers/47241) | [ChillyRoom](/publishers/45000) |
| [Birth of a Hunter](game:1027480) | March 4, 2019 | 19 | 63.2% | [Alex Tritt](/developers/325069) | [Alex Tritt](/publishers/309114) |
| [(Hidden Dragon Legend: Shadow Trace)](game:710130) | March 13, 2018 | 0 | 66% | N/A | N/A |

Please note that the catalog is sparse under the current filters, with only a few qualifying rows available.
```

### Run 3 Tool Calls

```json
[
  {
    "name": "search_games",
    "arguments": {
      "tags": [
        "Metroidvania"
      ],
      "is_free": true,
      "order_by": "reviews"
    },
    "executionMs": 1189,
    "success": true,
    "result_summary": "4 results",
    "coverage_complete": true,
    "sparse_result": true,
    "content_filter_backend": "app_filter_data"
  }
]
```

## Prompt #10

- Prompt: `tell me about Hades II`
- Run 1 score/verdict: `9/10` / `Strong`
- Run 1 tools: `lookup_games, query_analytics`
- Run 1 timing: `total 6734ms | llm 6156ms | tools 318ms | iterations 3`
- Run 2 status/timing: `success` / `200` / `11723ms`
- Run 2 tools: `lookup_games, query_analytics`
- Assessment: fixed the temporal error and now uses `GameCatalog` for a proper released-state lookup.

### Run 1 Output

```md
**[Hades II](game:1145350)** is an upcoming action roguelike game developed by Supergiant Games. It is set to be released on **September 25, 2025**. The game has received a **94.9%** positive review score, indicating strong anticipation and positive feedback from early access or previews.

If you have any specific questions about the game or its features, feel free to ask!
```

### Run 2 Output

```md
### Hades II Overview

- **Release Date:** September 25, 2025
- **Release State:** Released
- **Price:** $22.49 (currently discounted by 25%)
- **Total Reviews:** 115,199
- **Review Percentage:** 95.7% positive
- **Publisher:** [Supergiant Games](/publishers/2013)
- **Developer:** [Supergiant Games](/developers/2024)
- **Steam Deck Compatibility:** Verified
- **Platforms:** Windows, macOS

[Hades II](game:1145350) is the highly anticipated sequel to the critically acclaimed game Hades, developed by Supergiant Games. The game has received outstanding reviews, reflecting its quality and the strong reputation of its predecessor.
```

### Run 2 Tool Calls

```json
[
  {
    "name": "lookup_games",
    "arguments": {
      "query": "Hades II"
    },
    "executionMs": 413,
    "success": true,
    "result_summary": "5 results"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.publisherId",
        "GameCatalog.publisherName",
        "GameCatalog.developerId",
        "GameCatalog.developerName",
        "GameCatalog.releaseDate",
        "GameCatalog.releaseState",
        "GameCatalog.isReleased",
        "GameCatalog.priceDollars",
        "GameCatalog.discountPercent",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.steamDeckCategory",
        "GameCatalog.platforms"
      ],
      "filters": [
        {
          "member": "GameCatalog.appid",
          "operator": "equals",
          "values": [
            1145350
          ]
        }
      ],
      "limit": 1
    },
    "executionMs": 2671,
    "success": true,
    "result_summary": "1 rows"
  }
]
```

## Prompt #21

- Prompt: `Show me all the DLC for Elden Ring`
- Run 1 score/verdict: `9/10` / `Strong`
- Run 1 tools: `lookup_games, query_analytics`
- Run 1 timing: `total 8012ms | llm 7357ms | tools 440ms | iterations 3`
- Run 2 status/timing: `success` / `200` / `10354ms`
- Run 2 tools: `lookup_games, query_analytics`
- Assessment: fixed the hallucinated DLC substitution. The response now reflects the actual catalog integrity issue instead of inventing a clean DLC list.

### Run 1 Output

```md
Here are the DLCs related to **Elden Ring**:

| Game | Release Date |
|------|--------------|
| [ELDEN RING NIGHTREIGN](game:2622380) | May 29, 2025 |
| [ELDEN RING](game:1245620) | February 24, 2022 |

If you need more information about any specific DLC, feel free to ask!
```

### Run 2 Output

```md
The catalog for DLC related to **[ELDEN RING](game:1245620)** contains several entries, but unfortunately, the metadata for these DLCs is incomplete. Here are the DLC entries identified:

| DLC App ID | DLC Name | Source |
|------------|----------|--------|
| [1799420](game:1799420) | Not Available | PICS |
| [1896300](game:1896300) | Not Available | PICS |
| [1896320](game:1896320) | Not Available | PICS |
| [1922350](game:1922350) | Not Available | PICS |
| [2778580](game:2778580) | Not Available | Storefront |
| [2778590](game:2778590) | Not Available | Storefront |
| [2855520](game:2855520) | Not Available | PICS |
| [2855530](game:2855530) | Not Available | PICS |

The metadata for these DLCs is currently unavailable, so specific details such as names, types, and release dates are not provided. If you have any other questions or need further assistance, feel free to ask!
```

### Run 2 Tool Calls

```json
[
  {
    "name": "lookup_games",
    "arguments": {
      "query": "Elden Ring"
    },
    "executionMs": 251,
    "success": true,
    "result_summary": "6 results"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "DlcRelations",
      "dimensions": [
        "DlcRelations.parentAppid",
        "DlcRelations.parentName",
        "DlcRelations.dlcAppid",
        "DlcRelations.dlcName",
        "DlcRelations.dlcType",
        "DlcRelations.dlcReleaseDate",
        "DlcRelations.dlcReleaseState",
        "DlcRelations.childMetadataAvailable",
        "DlcRelations.source"
      ],
      "filters": [
        {
          "member": "DlcRelations.parentAppid",
          "operator": "equals",
          "values": [
            1245620
          ]
        }
      ],
      "limit": 50
    },
    "executionMs": 722,
    "success": true,
    "result_summary": "8 rows"
  }
]
```

## Prompt #138

- Prompt: `Games currently on sale`
- Run 1 score/verdict: `9/10` / `Strong`
- Run 1 tools: `query_analytics`
- Run 1 timing: `total 24166ms | llm 23194ms | tools 570ms | iterations 2`
- Run 2 status/timing: `success` / `200` / `25447ms`
- Run 2 tools: `query_analytics`
- Assessment: fixed the ranking problem. The answer now looks like a professional discovery result instead of a discount-only dump.

### Run 1 Output

```md
Here are some games currently on sale:

| Game | Price | Discount |
|------|-------|----------|
| [3D PUZZLE - Kingdom in dark](game:2670730) | $9.99 | 95% |
| [Find Match Icons](game:1752850) | $9.99 | 95% |
| [Car Parkour](game:2374570) | $4.99 | 95% |
| [Ero Tennis](game:1521770) | $9.99 | 95% |
| [Bike Offroad Simulator](game:2400760) | $4.99 | 95% |
| [Climb Challenge - Find Items 5](game:2878340) | $9.99 | 95% |
| [Fears of Glasses o-o World War](game:2244840) | $9.99 | 95% |
| [Lasertron](game:1488060) | $0.74 | 95% |
| [Hidden Pirates Top-Down 3D](game:2878310) | $9.99 | 95% |
| [3D PUZZLE - Hospital 1](game:2947730) | $9.99 | 95% |
| [3D PUZZLE - Apocalyptic Wasteland](game:3165280) | $9.99 | 95% |
| [HEDE Game Engine](game:1313330) | $9.99 | 95% |
| [BeachRun](game:1970730) | $1.24 | 95% |
| [ROOM FOOTBALL - Junk Town](game:3710460) | $9.99 | 95% |
| [They Сame From Above](game:1821630) | $1.24 | 95% |
| [ROOM FOOTBALL - Wetlands](game:3612760) | $9.99 | 95% |
| [Hidden World 9 Top-Down 3D](game:2682820) | $9.99 | 95% |
| [Hidden Ghost Town 2](game:1885010) | $9.99 | 95% |
| [★Fallalypse ★ Disconnect ❄](game:978610) | $9.99 | 95% |
| [Space Ship DRIFT](game:1584340) | $9.99 | 95% |

Enjoy your gaming!
```

### Run 2 Output

```md
Here are some games currently on sale:

| Game | Price | Discount | Release Date | Total Reviews | Review Percentage | Publisher | Developer |
|------|-------|----------|---------------|---------------|-------------------|-----------|-----------|
| [Terraria](game:105600) | $4.99 | 50% | May 16, 2011 | 1,507,686 | 97.4% | [Re-Logic](/publishers/2840) | [Re-Logic](/developers/12459) |
| [Garry's Mod](game:4000) | $4.99 | 50% | November 29, 2006 | 1,223,495 | 96.9% | [Valve](/publishers/1527) | [Facepunch Studios](/developers/1790) |
| [ELDEN RING](game:1245620) | $38.99 | 35% | February 24, 2022 | 1,120,128 | 93.0% | [BANDAI NAMCO Entertainment](/publishers/1959) | [FromSoftware, Inc.](/developers/3005) |
| [HELLDIVERS™ 2](game:553850) | $29.99 | 25% | February 8, 2024 | 1,117,694 | 77.0% | [PlayStation Publishing LLC](/publishers/7110) | [Arrowhead Game Studios](/developers/2261) |
| [Left 4 Dead 2](game:550) | $1.99 | 80% | November 16, 2009 | 1,021,614 | 97.5% | [Valve](/publishers/1527) | [Valve](/developers/1530) |
| [Stardew Valley](game:413150) | $7.49 | 50% | February 26, 2016 | 986,471 | 98.5% | [ConcernedApe](/publishers/3187) | [ConcernedApe](/developers/3256) |
| [Cyberpunk 2077](game:1091500) | $20.99 | 65% | December 9, 2020 | 923,154 | 86.2% | [CD PROJEKT RED](/publishers/6624) | [CD PROJEKT RED](/developers/6900) |
| [Euro Truck Simulator 2](game:227300) | $4.99 | 75% | October 12, 2012 | 904,000 | 97.5% | [SCS Software](/publishers/2157) | [SCS Software](/developers/1817) |
| [Dead by Daylight](game:381210) | $7.99 | 60% | June 14, 2016 | 885,079 | 78.6% | [Behaviour Interactive Inc.](/publishers/2961) | [Behaviour Interactive Inc.](/developers/3017) |
| [The Witcher 3: Wild Hunt](game:292030) | $7.99 | 80% | May 18, 2015 | 862,639 | 96.8% | [CD PROJEKT RED](/publishers/6624) | [CD PROJEKT RED](/developers/6900) |
| [Red Dead Redemption 2](game:1174180) | $14.99 | 75% | December 5, 2019 | 854,037 | 92.2% | [Rockstar Games](/publishers/1791) | [Rockstar Games](/developers/7555) |
| [Phasmophobia](game:739630) | $13.99 | 30% | September 18, 2020 | 813,665 | 95.6% | [Kinetic Games](/publishers/194117) | [Kinetic Games](/developers/204136) |
| [Among Us](game:945360) | $2.99 | 40% | November 16, 2018 | 724,700 | 91.9% | [Innersloth](/publishers/5415) | [Innersloth](/developers/5621) |
| [The Forest](game:242760) | $4.39 | 78% | April 30, 2018 | 663,281 | 95.5% | [Endnight Games Ltd](/publishers/2205) | [Endnight Games Ltd](/developers/2220) |
| [PAYDAY 2](game:218620) | $4.99 | 50% | August 13, 2013 | 663,082 | 89.6% | [Starbreeze Entertainment](/publishers/1776) | [OVERKILL - a Starbreeze Studio.](/developers/1777) |
| [Geometry Dash](game:322170) | $2.49 | 50% | December 22, 2014 | 559,573 | 93.1% | [RobTop Games](/publishers/11912) | [RobTop Games](/developers/12466) |
| [Hollow Knight](game:367520) | $7.49 | 50% | February 24, 2017 | 532,001 | 96.9% | [Team Cherry](/publishers/2963) | [Team Cherry](/developers/3019) |
| [Valheim](game:892970) | $9.99 | 50% | February 2, 2021 | 528,526 | 94.1% | [Coffee Stain Publishing](/publishers/2042) | [Iron Gate AB](/developers/5177) |
| [Lethal Company](game:1966720) | $7.99 | 20% | October 23, 2023 | 503,386 | 97.0% | [Zeekerss](/publishers/7690) | [Zeekerss](/developers/8057) |
| [Don't Starve Together](game:322330) | $5.09 | 66% | April 21, 2016 | 499,061 | 95.3% | [Klei Entertainment](/publishers/1676) | [Klei Entertainment](/developers/1675) |

These games are currently discounted, offering great deals for players!
```

### Run 2 Tool Calls

```json
[
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.discountPercent",
        "GameCatalog.releaseDate",
        "GameCatalog.releaseState",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.publisherId",
        "GameCatalog.publisherName",
        "GameCatalog.developerId",
        "GameCatalog.developerName"
      ],
      "segments": [
        "GameCatalog.onSale",
        "GameCatalog.released"
      ],
      "filters": [
        {
          "member": "GameCatalog.totalReviews",
          "operator": "set"
        }
      ],
      "order": {
        "GameCatalog.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 1225,
    "success": true,
    "result_summary": "20 rows"
  }
]
```

## Prompt #141

- Prompt: `Highly rated games under $10 released in the past year`
- Run 1 score/verdict: `9/10` / `Strong`
- Run 1 tools: `query_analytics, query_analytics`
- Run 1 timing: `total 25259ms | llm 24211ms | tools 630ms | iterations 2`
- Run 2 status/timing: `success` / `200` / `22277ms`
- Run 2 tools: `query_analytics, query_analytics`
- Assessment: fixed the tiny-sample quality problem by biasing toward titles with real review volume and richer metadata.

### Run 1 Output

```md
Here are some highly rated games under $10 that were released in the past year:

| Game | Review Score |
|------|--------------|
| [Foodslingers](game:2145460) | 100.0% |
| [World's Goodest Pup](game:2867220) | 100.0% |
| [Crawling Angels](game:3958640) | 95% |
| [Shapes of Memory](game:1593320) | 100.0% |
| [Primarch](game:1668970) | 92% |
| [Sphere Shootout](game:1924670) | 100.0% |
| [Skeleseller](game:3226210) | 97% |
| [Everything Will Be Fine!](game:3682360) | 91% |
| [Postal Strike](game:3799200) | 100.0% |
| [Midnight Scenes: Among Graves](game:4113480) | 100.0% |
| [Twisted Fate](game:4210680) | 95% |
| [MíManny](game:4335660) | 100.0% |
| [EGGCONSOLE ZANAC EX MSX2](game:4402830) | 100.0% |
| [Corgi Survivor](game:4483200) | 100.0% |
| [Duck and the Land of Flightless Birds](game:1735030) | 100.0% |
| [Thelos](game:2131840) | 100.0% |
| [Little Chef: Cozy Cooking](game:3376500) | 97% |
| [Ritus Exorcismus](game:3691430) | 100.0% |
| [Deadline Escape](game:3872000) | 91% |
| [Fumpers: Dual Realms](game:4288990) | 100.0% |

These games have received excellent reviews and are priced under $10.
```

### Run 2 Output

```md
Here are some highly rated games under $10 that were released in the past year:

| Game | Price | Total Reviews | Review Percentage | Release Date | Publisher | Developer |
|------|-------|---------------|-------------------|--------------|-----------|-----------|
| [PEAK](game:3527290) | $4.95 | 300,073 | 94.8% | June 16, 2025 | [landfall](/publishers/8300) | [Team PEAK](/developers/55973) |
| [Escape the Backrooms](game:1943950) | $7.99 | 133,591 | 90.7% | October 23, 2025 | [Secret Mode](/publishers/3989) | [Blackbird Interactive](/developers/7504) |
| [Megabonk](game:3405340) | $6.99 | 98,469 | 94.8% | September 18, 2025 | [vedinad](/publishers/49050) | [vedinad](/developers/51498) |
| [Deep Rock Galactic: Survivor](game:2321470) | $9.09 | 46,396 | 86.6% | September 17, 2025 | [Ghost Ship Publishing](/publishers/12273) | [Funday Games](/developers/8207) |
| [Soulstone Survivors](game:2066020) | $8.99 | 26,098 | 91.4% | June 17, 2025 | [Game Smithing Limited](/publishers/11659) | [Game Smithing Limited](/developers/12192) |
| [Pro Soccer Online](game:1583320) | $2.49 | 24,180 | 89.8% | December 5, 2025 | [Skywall Studios LLC](/publishers/241523) | [Skywall Studios LLC](/developers/253812) |
| [Mage Arena](game:3716600) | $2.69 | 19,896 | 91.5% | July 24, 2025 | [jrsjams](/publishers/89777) | [jrsjams](/developers/94500) |
| [LOCKDOWN Protocol](game:2780980) | $6.99 | 18,803 | 86.3% | November 18, 2025 | [Mirage Creative Lab](/publishers/23942) | [Mirage Creative Lab](/developers/25015) |
| [Ghost Watchers](game:1850740) | $8.99 | 16,073 | 85.9% | July 24, 2025 | [Renderise](/publishers/5030) | [Renderise](/developers/5229) |
| [MIMESIS](game:2827200) | $7.99 | 8,485 | 84.9% | October 27, 2025 | [KRAFTON, Inc.](/publishers/1788) | [ReLU Games, Inc.](/developers/21158) |

These games have received positive reviews and are priced affordably, making them great options for budget-conscious gamers.
```

### Run 2 Tool Calls

```json
[
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.releaseDate",
        "GameCatalog.releaseState",
        "GameCatalog.publisherId",
        "GameCatalog.publisherName",
        "GameCatalog.developerId",
        "GameCatalog.developerName"
      ],
      "segments": [
        "GameCatalog.released",
        "GameCatalog.lastYear"
      ],
      "filters": [
        {
          "member": "GameCatalog.priceDollars",
          "operator": "lte",
          "values": [
            "10"
          ]
        },
        {
          "member": "GameCatalog.totalReviews",
          "operator": "set"
        },
        {
          "member": "GameCatalog.reviewPercentage",
          "operator": "gte",
          "values": [
            "80"
          ]
        }
      ],
      "order": {
        "GameCatalog.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 4957,
    "success": true,
    "result_summary": "20 rows"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.releaseDate",
        "GameCatalog.releaseState",
        "GameCatalog.publisherId",
        "GameCatalog.publisherName",
        "GameCatalog.developerId",
        "GameCatalog.developerName"
      ],
      "segments": [
        "GameCatalog.released",
        "GameCatalog.lastYear"
      ],
      "filters": [
        {
          "member": "GameCatalog.priceDollars",
          "operator": "lte",
          "values": [
            "10"
          ]
        },
        {
          "member": "GameCatalog.totalReviews",
          "operator": "set"
        },
        {
          "member": "GameCatalog.reviewPercentage",
          "operator": "gte",
          "values": [
            "80"
          ]
        }
      ],
      "order": {
        "GameCatalog.releaseDate": "desc"
      },
      "limit": 20
    },
    "executionMs": 980,
    "success": true,
    "result_summary": "20 rows"
  }
]
```

## Prompt #219

- Prompt: `Games under $5 with overwhelmingly positive reviews`
- Run 1 score/verdict: `7/10` / `Acceptable`
- Run 1 tools: `search_games, search_games`
- Run 1 timing: `total 12390ms | llm 11562ms | tools 609ms | iterations 2`
- Run 2 status/timing: `success` / `200` / `18538ms`
- Run 2 tools: `query_analytics, query_analytics`
- Run 3 status/timing: `success` / `200` / `46529ms`
- Run 3 tools: `query_analytics, query_analytics`
- Assessment: fixed in Run 3. The model still initially emits a shared-field `Discovery` query, but the server-side canonicalization layer rewrites it to `GameCatalog`, so the guardrail now applies across future broad price/review discovery prompts without query-specific handling.

### Run 1 Output

```md
Here are some games under $5 with overwhelmingly positive reviews:

| Game | Price | Review Percentage | Developer | Publisher |
|------|-------|-------------------|-----------|-----------|
| [Corgi Survivor](game:4483200) | $4.24 | 100% | [Symbolic](/developers/3199485) | [Symbolic](/publishers/3050097) |
| [Sphere Shootout](game:1924670) | $4.79 | 100% | [Horace49 (程序员慧鹏)](/developers/305839) | [Horace49 (程序员慧鹏)](/publishers/290987) |
| [Shapes of Memory](game:1593320) | $3.39 | 100% | [Abyssal Studios](/developers/8911) | [Creative Hand](/publishers/129394) |

Additionally, here are some games currently on sale that also have overwhelmingly positive reviews:

| Game | Price | Review Percentage | Developer | Publisher |
|------|-------|-------------------|-----------|-----------|
| [AI.VI](game:2892380) | $11.19 | 100% | [Out of Time](/developers/30460) | [indie.io](/publishers/3794) |
| [Crawling Angels](game:3958640) | $7.99 | 95% | [ItsTheTalia](/developers/135466) | [2 Left Thumbs](/publishers/8709) |
| [World's Goodest Pup](game:2867220) | $6.29 | 100% | [Pandamander, LLC](/developers/29148) | [Pandamander, LLC](/publishers/27885) |
| [Twisted Fate](game:4210680) | $6.39 | 95% | [Game Dynasty](/developers/8798) | [Game Dynasty](/publishers/227853) |

*Note: Prices are subject to change and may vary based on discounts.*
```

### Run 2 Output

```md
Here are some games under $5 that have overwhelmingly positive reviews:

| Game | Price | Review Percentage | Total Reviews |
|------|-------|-------------------|---------------|
| [Terraria](game:105600) | $4.99 | 97.4% | 1,507,686 |
| [Garry's Mod](game:4000) | $4.99 | 96.9% | 1,223,495 |
| [Left 4 Dead 2](game:550) | $1.99 | 97.5% | 1,021,614 |
| [Euro Truck Simulator 2](game:227300) | $4.99 | 97.5% | 904,000 |
| [The Forest](game:242760) | $4.39 | 95.5% | 663,281 |
| [Dying Light](game:239140) | $2.49 | 95.2% | 480,491 |
| [Undertale](game:391540) | $2.49 | 96.8% | 317,184 |
| [Titanfall® 2](game:1237970) | $2.99 | 95.6% | 274,593 |
| [Half-Life 2](game:220) | $1.99 | 97.6% | 268,645 |
| [Tomb Raider Game of the Year](game:203160) | $2.99 | 96.1% | 262,426 |
| [Vampire Survivors](game:1794680) | $3.74 | 98.4% | 260,488 |
| [Counter-Strike](game:10) | $1.99 | 97.4% | 258,175 |
| [Fallout: New Vegas](game:22380) | $0.99 | 96.0% | 253,807 |
| [DOOM](game:379720) | $3.99 | 95.5% | 216,276 |
| [Sid Meier's Civilization® V](game:8930) | $2.99 | 95.8% | 204,265 |
| [Portal](game:400) | $1.99 | 98.5% | 191,591 |
| [Counter-Strike: Source](game:240) | $1.99 | 96.3% | 189,867 |
| [Life is Strange - Episode 1](game:319630) | $0.00 | 96.2% | 169,201 |
| [Mount & Blade: Warband](game:48700) | $4.99 | 97.7% | 166,405 |
| [Half-Life](game:70) | $1.99 | 96.5% | 158,774 |

These games are highly rated and offer great value for their price!
```

### Run 2 Tool Calls

```json
[
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "Discovery",
      "dimensions": [
        "Discovery.appid",
        "Discovery.name",
        "Discovery.priceDollars",
        "Discovery.reviewPercentage"
      ],
      "segments": [
        "Discovery.overwhelminglyPositive"
      ],
      "filters": [
        {
          "member": "Discovery.priceDollars",
          "operator": "lte",
          "values": [
            "5"
          ]
        }
      ],
      "order": {
        "Discovery.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 1439,
    "success": true,
    "result_summary": "20 rows"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "Discovery",
      "dimensions": [
        "Discovery.appid",
        "Discovery.name",
        "Discovery.priceDollars",
        "Discovery.reviewPercentage"
      ],
      "segments": [
        "Discovery.overwhelminglyPositive"
      ],
      "filters": [
        {
          "member": "Discovery.priceDollars",
          "operator": "lte",
          "values": [
            "5"
          ]
        }
      ],
      "order": {
        "Discovery.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 480,
    "success": true,
    "result_summary": "20 rows"
  }
]
```

### Run 3 Output

```md
Here are some games under $5 with overwhelmingly positive reviews:

| Game | Price | Total Reviews | Review Percentage |
|------|-------|---------------|-------------------|
| [Terraria](game:105600) | $4.99 | 1,507,686 | 97.4% |
| [Garry's Mod](game:4000) | $4.99 | 1,223,495 | 96.9% |
| [Left 4 Dead 2](game:550) | $1.99 | 1,021,614 | 97.5% |
| [Wallpaper Engine](game:431960) | $3.99 | 967,703 | 98.0% |
| [Euro Truck Simulator 2](game:227300) | $4.99 | 904,000 | 97.5% |
| [The Forest](game:242760) | $4.39 | 663,281 | 95.5% |
| [Dying Light](game:239140) | $2.49 | 480,491 | 95.2% |
| [Undertale](game:391540) | $2.49 | 317,184 | 96.8% |
| [Titanfall® 2](game:1237970) | $2.99 | 274,593 | 95.6% |
| [Half-Life 2](game:220) | $1.99 | 268,645 | 97.6% |
| [Tomb Raider Game of the Year](game:203160) | $2.99 | 262,426 | 96.1% |
| [Vampire Survivors](game:1794680) | $3.74 | 260,488 | 98.4% |
| [Counter-Strike](game:10) | $1.99 | 258,175 | 97.4% |
| [Fallout: New Vegas](game:22380) | $0.99 | 253,807 | 96.0% |
| [DOOM](game:379720) | $3.99 | 216,276 | 95.5% |
| [Sid Meier's Civilization® V](game:8930) | $2.99 | 204,265 | 95.8% |
| [Portal](game:400) | $1.99 | 191,591 | 98.5% |
| [Counter-Strike: Source](game:240) | $1.99 | 189,867 | 96.3% |
| [Mount & Blade: Warband](game:48700) | $4.99 | 166,405 | 97.7% |
| [Half-Life](game:70) | $1.99 | 158,774 | 96.5% |

These games have received high praise from players and are available at a very low price.
```

### Run 3 Tool Calls

```json
[
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "Discovery",
      "dimensions": [
        "Discovery.appid",
        "Discovery.name",
        "Discovery.priceDollars",
        "Discovery.totalReviews",
        "Discovery.reviewPercentage"
      ],
      "segments": [
        "Discovery.overwhelminglyPositive"
      ],
      "filters": [
        {
          "member": "Discovery.priceDollars",
          "operator": "lte",
          "values": [
            "5"
          ]
        }
      ],
      "order": {
        "Discovery.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 1570,
    "success": true,
    "result_summary": "20 rows",
    "canonicalizedFromCube": "Discovery",
    "canonicalizedToCube": "GameCatalog"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage"
      ],
      "segments": [
        "GameCatalog.onSale"
      ],
      "filters": [
        {
          "member": "GameCatalog.priceDollars",
          "operator": "lte",
          "values": [
            "5"
          ]
        },
        {
          "member": "GameCatalog.reviewPercentage",
          "operator": "gte",
          "values": [
            "95"
          ]
        }
      ],
      "order": {
        "GameCatalog.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 1444,
    "success": true,
    "result_summary": "20 rows"
  }
]
```

## Prompt #242

- Prompt: `Premium games over $40 with great reviews`
- Run 1 score/verdict: `6/10` / `Acceptable`
- Run 1 tools: `search_games, search_games`
- Run 1 timing: `total 4535ms | llm 3727ms | tools 506ms | iterations 2`
- Run 2 status/timing: `success` / `200` / `24779ms`
- Run 2 tools: `query_analytics, query_analytics`
- Assessment: fixed the false-zero-result behavior and now returns the expected premium/high-price discovery set.

### Run 1 Output

```md
It appears that there are currently no premium games tagged as such that meet the criteria of being released in 2020 or later with review scores of 80% or higher.

If you have other criteria or specific genres in mind, please let me know, and I can help you find suitable games!
```

### Run 2 Output

```md
Here are some premium games priced over $40 that have received great reviews:

| Game | Price | Total Reviews | Review Percentage | Publisher | Developer |
|------|-------|---------------|-------------------|-----------|-----------|
| [Black Myth: Wukong](game:2358720) | $59.99 | 1,195,963 | 96.5% | [Game Science](/publishers/123) | [Game Science](/developers/123) |
| [Baldur's Gate 3](game:1086940) | $59.99 | 829,902 | 96.8% | [Larian Studios](/publishers/456) | [Larian Studios](/developers/456) |
| [DARK SOULS™ III](game:374320) | $59.99 | 431,437 | 94.3% | [BANDAI NAMCO Entertainment](/publishers/789) | [FromSoftware, Inc.](/developers/789) |
| [S.T.A.L.K.E.R. 2: Heart of Chornobyl](game:1643320) | $41.99 | 113,346 | 80.5% | [GSC Game World (worldwide)](/publishers/101) | [GSC Game World](/developers/101) |
| [ARMORED CORE™ VI FIRES OF RUBICON™](game:1888160) | $59.99 | 82,675 | 91.6% | [FromSoftware, Inc.](/publishers/789) | [FromSoftware, Inc.](/developers/789) |
| [CODE VEIN](game:678960) | $59.99 | 61,143 | 83.4% | [BANDAI NAMCO Entertainment](/publishers/789) | [Bandai Namco Studios](/developers/789) |
| [Call of Duty: Black Ops II](game:202970) | $59.99 | 48,523 | 86.2% | [Activision](/publishers/102) | [Treyarch](/developers/102) |
| [Jurassic World Evolution 2](game:1244460) | $59.99 | 45,355 | 90.2% | [Frontier Developments](/publishers/103) | [Frontier Developments](/developers/103) |
| [LEGO Star Wars: The Skywalker Saga](game:920210) | $49.99 | 45,038 | 90.7% | [Warner Bros. Interactive Entertainment](/publishers/104) | [TT Games](/developers/104) |
| [God of War Ragnarök](game:2322010) | $40.19 | 44,031 | 88.3% | [PlayStation Publishing LLC](/publishers/105) | [Santa Monica Studio](/developers/105) |

These games are highly rated and have a significant number of reviews, indicating their popularity and quality.
```

### Run 2 Tool Calls

```json
[
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.publisherName",
        "GameCatalog.developerName"
      ],
      "filters": [
        {
          "member": "GameCatalog.priceDollars",
          "operator": "gte",
          "values": [
            "40"
          ]
        },
        {
          "member": "GameCatalog.totalReviews",
          "operator": "set"
        }
      ],
      "segments": [
        "GameCatalog.released",
        "GameCatalog.highlyRated"
      ],
      "order": {
        "GameCatalog.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 1848,
    "success": true,
    "result_summary": "20 rows"
  },
  {
    "name": "query_analytics",
    "arguments": {
      "cube": "GameCatalog",
      "dimensions": [
        "GameCatalog.appid",
        "GameCatalog.name",
        "GameCatalog.priceDollars",
        "GameCatalog.totalReviews",
        "GameCatalog.reviewPercentage",
        "GameCatalog.publisherName",
        "GameCatalog.developerName"
      ],
      "filters": [
        {
          "member": "GameCatalog.priceDollars",
          "operator": "gte",
          "values": [
            "40"
          ]
        },
        {
          "member": "GameCatalog.totalReviews",
          "operator": "set"
        },
        {
          "member": "GameCatalog.totalReviews",
          "operator": "lt",
          "values": [
            "1000"
          ]
        }
      ],
      "segments": [
        "GameCatalog.released",
        "GameCatalog.highlyRated"
      ],
      "order": {
        "GameCatalog.totalReviews": "desc"
      },
      "limit": 20
    },
    "executionMs": 2563,
    "success": true,
    "result_summary": "20 rows"
  }
]
```
