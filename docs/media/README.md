# README media

Captured from the running local Faultline app on 18 October 2026 at a 1440 × 1100 viewport, with FalkorDB connected and the deterministic **RULES + MCP** investigator selected. The screenshots contain synthetic sandbox records.

| File | Captured state |
| --- | --- |
| `faultline-overview.png` | Current landing page; its graph is an illustrative preview |
| `incident-triggered.png` | Product-data fault triggered; checkout fails |
| `incident-diagnosed.png` | Product-data diagnosed; healthy payments ruled out |
| `graph-queries.png` | Four executed Cypher queries and their metadata |
| `incident-recovered.png` | Approved configuration rollback; identical checkout request changes from HTTP 503 to HTTP 200 |
| `faultline-walkthrough.gif` | Looping screenshot sequence: triggered (4s), diagnosed (6s), queries (5s), recovered (5s) |
| `faultline-walkthrough.mp4` | Silent 20-second video of the same screenshot sequence |

The animation and video show captured states rather than continuous interaction. They do not demonstrate a live OpenAI investigation or production service recovery. The PNGs are the source frames; FFmpeg produces the GIF with a shared palette at 1080px wide and the H.264 MP4 at the original viewport size.

To refresh, start the app and database, select **RULES + MCP**, trigger a product-data fault, investigate, inspect **Graph queries**, return to **Evidence**, and approve **Revert configuration in sandbox**. Capture each state after the operation finishes and verify HTTP 200 on the final screen. Keep the README captions and both walkthrough formats consistent with the new frames.
