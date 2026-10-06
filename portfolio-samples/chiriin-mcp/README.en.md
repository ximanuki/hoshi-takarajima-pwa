# chiriin-mcp — MCP server for Japan's GSI open data

[日本語](README.md)

An [MCP](https://modelcontextprotocol.io/) server that lets AI assistants such as Claude use the open APIs and open data of Japan's Geospatial Information Authority (GSI, 国土地理院). **No API key is required.**

- **Hazard lookup**: checks a point against the GSI Hazard Map Portal (重ねるハザードマップ) for flood, inland flood, storm surge and tsunami inundation depth, inundation duration, house-collapse flood zones and sediment-disaster (landslide) warning zones
- **Geocoding**: address or place name → coordinates
- **Elevation**: ground elevation from the most accurate DEM available at the point (1 m / 5 m laser, etc.)
- **Survey calculations**: geodesic distance and azimuth, conversion to and from Japan Plane Rectangular Coordinates (with automatic zone selection), and geoid height (JGEOID2024)

Every tool accepts either an address or a lat/lon pair. Results include a ready-to-paste attribution line and the required caveats.

> Data from the Hazard Map Portal must not be used for the Important Matters Explanation (重要事項説明) in Japanese real-estate transactions (per the GSI terms). Treat the results as research aids and confirm with the municipal hazard map.

## Why this server

There are already many MCP servers for the e-Gov law API and similar services, but no open-source MCP server for GSI's survey calculation API or for point-level hazard-map lookups (see [RESEARCH.md](RESEARCH.md), in Japanese).

- **11 hazard layers**, with depth classes (under 0.3 m to 20 m or more), duration classes (under 12 h to 4+ weeks), special-warning vs. warning zones, and designated vs. to-be-designated zones
- **Transparent decisions**: legend colours were read pixel-exactly from the official legend images, and every result includes the tile URL and the sampled colour. The PNG decoder is dependency-free and tested pixel-for-pixel against Pillow
- **Plays by the rules**: honours the survey API's limit of 10 requests per 10 s per IP, with timeouts, retries (exponential backoff and Retry-After), a response-size cap and caching
- **Bilingual errors** (Japanese and English) with actionable hints
- **stdio and Streamable HTTP** transports

## Installation

Requires Node.js 22 or later.

### Claude Desktop

```json
{
  "mcpServers": {
    "chiriin": {
      "command": "npx",
      "args": ["-y", "chiriin-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add chiriin -- npx -y chiriin-mcp
# or for all projects
claude mcp add --scope user chiriin -- npx -y chiriin-mcp
```

### From source

```bash
git clone https://github.com/ximanuki/chiriin-mcp.git && cd chiriin-mcp
npm ci && npm run build
claude mcp add chiriin -- node "$(pwd)/dist/index.js"
```

### Streamable HTTP

```bash
npx -y chiriin-mcp --http --port 3000      # POST http://127.0.0.1:3000/mcp, GET /healthz
claude mcp add --transport http chiriin http://127.0.0.1:3000/mcp
```

The HTTP server is stateless and listens on 127.0.0.1 by default, with Host-header checks against DNS rebinding. If you expose it, put an authenticating reverse proxy in front of it.

Behind a proxy: Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or later).

## Tools

The point arguments are shared by all tools: pass either `address` (an address or place name) or `lat` and `lon` (JGD2011, decimal degrees).

| Tool | Purpose | Key inputs | Key structured output |
|---|---|---|---|
| `get_hazard_info` | Hazard zones (11 layers) and elevation at a point | point, `layers?`, `include_elevation?` | `inZone`, `layers[]` (status, class, colour, tile URL), `elevation`, `links`, `attribution`, `disclaimer` |
| `geocode_address` | Address or place name → candidate coordinates | `query`, `limit?` (1–50) | `candidates[]`, `total`, `truncated` |
| `get_elevation` | Elevation above Tokyo Bay mean sea level | point | `elevationM`, `source`, `resolutionM` |
| `calc_distance` | Geodesic distance and azimuths (GRS80) | `from`, `to` | `distanceM`, `azimuthFromStartDeg`, `azimuthFromEndDeg`, `directionJa` |
| `latlon_to_plane` | Lat/lon → plane rectangular X (north) / Y (east) | point, `zone?` (inferred from the address's prefecture if omitted) | `x`, `y`, `zone`, `zoneSelection`, `gridConvergenceDeg`, `scaleFactor` |
| `plane_to_latlon` | Plane rectangular → lat/lon | `x`, `y`, `zone` | `lat`, `lon`, `latDms`, `lonDms` |
| `get_geoid_height` | Geoid height (JGEOID2024); ellipsoidal → orthometric height | point, `ellipsoidal_height?` | `geoidHeightM`, `referenceCorrectionM`, `orthometricHeightM` |

Layer ids: `flood_max`, `flood_planned`, `flood_duration`, `house_collapse_overflow`, `house_collapse_erosion`, `inland_flood`, `storm_surge`, `tsunami`, `debris_flow`, `steep_slope`, `landslide`. Each layer's status is `in_zone`, `not_in_zone`, `unknown_color` or `error`. If some layers fail, the results for the other layers are still returned.

Resources: `chiriin://hazard-layers` (layers, legends, tile templates) and `chiriin://plane-rectangular-zones`.

## Example conversation

> **User**: I'm thinking of renting an office at 東京都江東区東陽4-11-28. What is the flood risk?
>
> **Claude** (calls `get_hazard_info` with `{"address": "東京都江東区東陽4-11-28"}`): According to GSI's Hazard Map Portal (elevation −1.2 m), the point is in the river-flood zone with **3–5 m** depth (maximum-assumed rainfall, enough to reach the second floor) and the storm-surge zone with **3–5 m** depth, and flooding may last **two weeks or more**. It is not in an inland-flood, tsunami or landslide zone. Check the Koto City hazard map before deciding. This result cannot be used for the Important Matters Explanation.
>
> Source: 「ハザードマップポータルサイト」(https://disaportal.gsi.go.jp/) open data, processed.

## How hazard lookup works

1. Compute the zoom-17 tile (about 1 m per pixel) that contains the point.
2. Fetch `https://disaportaldata.gsi.go.jp/raster/{layer}/17/{x}/{y}.png`. A 404 means the tile has no data, i.e. the point is outside every zone of that layer.
3. Decode the PNG and match the pixel colour against the legend (RGB distance of 7 or less).
4. Boundary lines and circle-hatched layers are resolved from the neighbouring pixels, and this is noted in `noteJa`. A zone within a few metres of an outside point is reported in `nearbyWithinM`.

## Caveats

- **"Not in zone" does not mean "safe".** Some prefectures and municipalities have not created or published their data.
- Address search uses the endpoint behind GSI Maps' search box, which has no published third-party specification or SLA. It is accurate to the block level and weak at facility names.
- Reverse geocoding is not offered: GSI's reverse geocoder endpoint no longer resolves (checked October 2026).
- Hokkaido spans three plane-rectangular zones, so pass `zone` explicitly there.

## Data sources and terms

| Data | Provider | Terms |
|---|---|---|
| Hazard Map Portal open data | GSI (the underlying data is from MLIT, prefectures and municipalities) | [Public Data License 1.0](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0). Attribution is required, and processing must be stated. [Terms](https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/copyright.html) |
| Elevation API | GSI | [Usage notes](https://maps.gsi.go.jp/development/elevation_s.html): do not overload the server |
| Survey calculation API | GSI | [API help](https://vldb.gsi.go.jp/sokuchi/surveycalc/api_help.html): at most 10 requests per 10 s per IP |
| Address search | GSI Maps | Used as provided by GSI Maps, with no guarantee for third-party use |

This project is not affiliated with or endorsed by GSI.

## Configuration

`CHIRIIN_TIMEOUT_MS` (default 10000), `CHIRIIN_RETRIES` (2), `CHIRIIN_USER_AGENT`, `CHIRIIN_MAX_RESPONSE_BYTES` (2 MiB), `MCP_TRANSPORT=http`, `PORT` (3000), `HOST` (127.0.0.1).

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run smoke            # opt-in: calls the live APIs through the built server (stdio)
npm run smoke -- --http  # the same over Streamable HTTP
npm run record-fixtures  # re-record test/recorded/ from the live APIs (after build)
```

Tests never touch the network: `fetch` is replaced in the test setup, and the real responses recorded in `test/recorded/` (JSON plus 13 PNG tiles) are replayed.

## License

[MIT](LICENSE). The data you retrieve is subject to the terms listed above.
