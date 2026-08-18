# 08 — Flow Diagrams

> Mermaid diagrams of the four core flows. They render on GitHub, in VS Code / Antigravity
> with a Mermaid preview, and in any Mermaid-aware viewer. Node fills use the loomJS category
> palette (UI violet, FN red, API teal, State blue, DB amber). These diagrams follow the
> decisions in `02-system-architecture.md` and `03-system-memory.md` — if they ever conflict,
> those docs win.

---

## 1. System flow — the end-to-end pipeline

The macro loop: the graph is an intermediate representation the compiler emits into a real
owned repo; the app runs on the **user's own** Supabase + Vercel (BYO-backend); secrets stay
server-only in the env bucket.

```mermaid
flowchart TD
    subgraph BUILD["loomJS — building experience (loom owns)"]
        D["Design mode<br/>artboards + components + flow arrows"]
        N["Nodes mode<br/>UI / FN / API / STATE / DB graph"]
        IR["Graph = Intermediate Representation<br/>stable ids, atomic ops"]
        C["Compiler<br/>walk graph, stitch code templates"]
        D --> IR
        N --> IR
        IR --> C
    end

    subgraph EMIT["Emitted artifacts (adapters)"]
        FE["Vite + React + TS SPA<br/>react-router"]
        BE["Vercel serverless /api functions"]
    end
    C --> FE
    C --> BE

    PV["Preview<br/>runs compiled app vs dev database"]
    FE -->|preview| PV
    BE -->|preview| PV

    subgraph BYO["user owns infrastructure (BYO-backend)"]
        SB[("User's Supabase<br/>Postgres + Auth + RLS")]
        VC["User's Vercel<br/>managed deploy"]
    end
    PV -->|reads / writes| SB
    FE -->|Deploy / Ship| VC
    BE -->|Deploy / Ship| VC
    VC -->|runtime| SB

    ENV["Env bucket (encrypted)<br/>secrets, server-only<br/>injected at deploy, by name"]
    ENV -.->|credentials| SB
    ENV -.->|tokens| VC

    classDef own fill:#F6F7F9,stroke:#E8EAEE,color:#1B1D21;
    classDef env fill:#FFFFFF,stroke:#868D97,color:#1B1D21;
    class ENV env;
```

---

## 2. Platform flow — account & project lifecycle

Gated signup → workspace → project dashboard → editor. Snapshots live in R2; queryable
metadata + the R2 pointer live in the platform's own Supabase. Save order is **R2 blob first,
then the Postgres pointer** (an orphan blob is harmless; a dangling pointer is not).

```mermaid
flowchart TD
    START(["Visitor"]) --> GATE{"Invite / allowlist gated?"}
    GATE -->|no code| WAIT["Waitlist"]
    GATE -->|valid invite| SU["Sign up<br/>platform auth via Supabase"]
    SU --> VERIFY["Verify email"]
    VERIFY --> WS
    LOGIN(["Returning user"]) -->|platform auth| WS["Enter Workspace<br/>single in V1, team-ready model"]

    WS --> DASH["Project dashboard<br/>create / open / rename / duplicate / delete"]
    DASH -->|create| NEW["New project<br/>empty snapshot"]
    DASH -->|open| OPEN["Open project"]
    NEW --> LOAD
    OPEN --> LOAD["Load snapshot from R2<br/>via Postgres pointer"]
    LOAD --> EDITOR["Editor (canvas)"]

    EDITOR -->|save| SAVE["1 - write snapshot blob to R2"]
    SAVE --> PTR["2 - update Postgres pointer + metadata"]
    PTR --> EDITOR

    subgraph STORE["Platform storage (loom owns)"]
        PG[("Platform Supabase<br/>users / workspaces / projects / membership")]
        R2[("Cloudflare R2<br/>snapshots + assets")]
    end
    LOAD -.-> R2
    LOAD -.-> PG
    SAVE -.-> R2
    PTR -.-> PG

    classDef db fill:#FBF1DF,stroke:#D98A12,color:#1B1D21;
    class PG,R2 db;
```

---

## 3. Canvas flow — Design mode → component becomes node

Placing a component instantiates a **property schema** (the inspector renders from it) and
auto-creates a **mirror UI node** in Nodes mode whose ports derive from that schema. Flow
arrows compile to routes. Ownership is one-way: the artboard owns existence + appearance;
Nodes mode owns behavior.

```mermaid
flowchart TD
    A["Designer drags a component<br/>onto an artboard"] --> B["Component instance created<br/>from a property schema"]
    B --> C["Inspector renders properties<br/>from the schema"]

    C --> D{"Property value kind"}
    D -->|static| S["Literal the designer typed"]
    D -->|bound| BND["Wire to a backend node<br/>Design to Nodes bridge"]
    D -->|event| EVT["Handler / flow trigger"]

    B --> MN["Mirror UI node auto-created<br/>in Nodes mode"]
    MN --> P1["data-properties become data ports"]
    MN --> P2["events become trigger ports"]
    MN --> P3["inputs bidirectional:<br/>value out + setValue in"]

    B --> FR{"Inside a container frame?"}
    FR -->|yes| AGG["Frame aggregates children<br/>into one composed object port"]
    FR -->|no| STOP["Standalone component"]

    A2["Designer draws a flow arrow<br/>between artboards"] --> RT["Compiles to a route + guard;<br/>arrow may carry a payload"]

    B -.->|governed by| O1["Ownership: artboard owns<br/>existence + appearance"]
    MN -.->|governed by| O2["Ownership: Nodes mode owns<br/>behavior / wiring"]

    classDef ui fill:#F2EFFE,stroke:#7C5CFF,color:#1B1D21;
    class B,MN,P1,P2,P3 ui;
```

---

## 4. Logic flow — Nodes mode data flow (triggered + reactive)

Data flows along wires through the FN vocabulary into the connector and back to the UI. Two
trigger modes coexist on one screen: **triggered** (fires on an event port — search / add) and
**reactive** (runs on mount — the dashboard list). The connector exposes typed per-table nodes
from introspection; the service key reaches it only from the server side (env bucket).

```mermaid
flowchart LR
    subgraph TRIG["Triggered pipeline (user action) - search / add"]
        BTN["Button node<br/>onClick (trigger port)"]:::ui
        INP["Input node<br/>value (data port)"]:::ui
        VAL["Validate (FN)"]:::fn
        GATE["Gate / Guard (FN)"]:::fn
        MUT["Mutation / Query<br/>API route to connector op"]:::api
        OUT1["Result to Label / List<br/>UI display port"]:::ui

        BTN -->|fires| VAL
        INP -->|data| VAL
        VAL --> GATE
        GATE -->|true| MUT
        MUT --> OUT1
    end

    subgraph REACT["Reactive pipeline (on mount) - dashboard"]
        Q["Query (auto)<br/>runs on load"]:::api
        LIST["List node<br/>items port"]:::ui
        Q --> LIST
    end

    subgraph DATA["Connector - BYO Supabase"]
        DB[("transactions table<br/>typed ports from introspection")]:::db
    end

    MUT <-->|insert / read| DB
    Q <-->|read| DB

    ENVN["Env bucket<br/>server-only"]:::env
    ENVN -.->|service key| DB

    classDef ui fill:#F2EFFE,stroke:#7C5CFF,color:#1B1D21;
    classDef fn fill:#FDECE8,stroke:#EC3013,color:#1B1D21;
    classDef api fill:#E6F6F1,stroke:#12A07A,color:#1B1D21;
    classDef state fill:#E9F1FD,stroke:#2F7DE1,color:#1B1D21;
    classDef db fill:#FBF1DF,stroke:#D98A12,color:#1B1D21;
    classDef env fill:#FFFFFF,stroke:#868D97,color:#1B1D21;
```

---

## Palette legend

| Category | Stroke | Tint |
| --- | --- | --- |
| UI node | `#7C5CFF` | `#F2EFFE` |
| Function (FN) | `#EC3013` | `#FDECE8` |
| API route | `#12A07A` | `#E6F6F1` |
| State | `#2F7DE1` | `#E9F1FD` |
| Database (DB) | `#D98A12` | `#FBF1DF` |
| Env / neutral | `#868D97` | `#FFFFFF` |
