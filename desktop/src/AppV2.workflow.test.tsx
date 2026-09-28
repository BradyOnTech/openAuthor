// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke as mockedInvoke } from "@tauri-apps/api/core";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppV2 } from "./AppV2";

const harness = vi.hoisted(() => ({
  initialized: false,
  projectId: "proj-golden-loop",
  projectRoot: "/tmp/openauthor-golden-loop",
  scenes: [] as Array<Record<string, unknown>>,
  proposals: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  entities: [] as Array<Record<string, unknown>>,
  relationships: [] as Array<Record<string, unknown>>,
  facts: [] as Array<Record<string, unknown>>,
  arcStates: [] as Array<Record<string, unknown>>,
  suggestions: [] as Array<Record<string, unknown>>,
  plan: {
    schema_version: 1,
    brief: { synopsis: "", genre: "", themes: [] as string[], style_guide: "", outline: "" },
    acts: [] as Array<Record<string, unknown>>,
    unassigned_scene_ids: [] as string[],
    scene_metadata: {} as Record<string, { timeline_position: string; labels: string[] }>,
    beats: [] as Array<Record<string, unknown>>,
    notes: [] as Array<Record<string, unknown>>,
  },
  storylines: [] as Array<Record<string, unknown>>,
  primaryBranch: "main",
  currentBranch: "main",
  calls: [] as string[][],
  saveGate: null as null | (() => Promise<void>),
  saveRoots: [] as string[],
  versions: [] as Array<Record<string, unknown>>,
  branchScenes: {} as Record<string, Array<Record<string, unknown>>>,
}));

function response(payload: unknown, status = 0) {
  return {
    status,
    stdout: typeof payload === "string" ? payload : JSON.stringify(payload),
    stderr: status === 0 ? "" : String(payload),
  };
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? "" : "";
}

function hasArgument(args: string[], name: string): boolean {
  return args.includes(name);
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, payload: { projectRoot?: string; args?: string[] }) => {
    if (command === "project_status") {
      return {
        found: harness.initialized,
        project_root: payload.projectRoot || harness.projectRoot,
      };
    }
    if (command === "sidecar_request") {
      throw new Error("Sidecar is intentionally unavailable in the rendered contract test.");
    }
    if (command !== "core_command") {
      throw new Error(`Unexpected Tauri command: ${command}`);
    }

    const args = payload.args ?? [];
    harness.calls.push(args);
    const root = args[0];
    const action = args[1];

    if (root === "init") {
      harness.initialized = true;
      harness.projectRoot = args[1];
      harness.projectId = argument(args, "--project-id") || harness.projectId;
      return response({
        initialized: true,
        project_root: harness.projectRoot,
        project_id: harness.projectId,
        name: argument(args, "--name"),
      });
    }
    if (root === "project" && action === "ensure-id") {
      return response({ project_id: harness.projectId, name: "Golden Novel" });
    }
    if (root === "project" && action === "inspect") {
      return response({ project_id: harness.projectId, name: "Golden Novel" });
    }
    if (root === "backup") {
      if (action === "restore") harness.initialized = true;
      return response({ verified: true, file_count: 20, path: argument(args, "--target"), project_root: argument(args, "--target") });
    }
    if (root === "manuscript" && action === "preview") {
      return response({
        source: argument(args, "--source"),
        strategy: argument(args, "--strategy") || "auto",
        scene_count: 2,
        word_count: 10,
        warnings: [],
        scenes: [
          { position: 1, title: "Imported Arrival", source_path: argument(args, "--source"), source_format: "docx", word_count: 5, excerpt: "Arrival prose." },
          { position: 2, title: "Imported Choice", source_path: argument(args, "--source"), source_format: "docx", word_count: 5, excerpt: "Choice prose." },
        ],
      });
    }
    if (root === "manuscript" && action === "import") {
      const now = "2026-07-15T12:00:00Z";
      harness.scenes.push(
        { id: "scene-0001", title: "Imported Arrival", summary: "", pov: "", status: "draft", body: "Arrival prose from the manuscript.", created_at: now, updated_at: now, path: "manuscript/scenes/0001-imported-arrival.md" },
        { id: "scene-0002", title: "Imported Choice", summary: "", pov: "", status: "draft", body: "Choice prose from the manuscript.", created_at: now, updated_at: now, path: "manuscript/scenes/0002-imported-choice.md" },
      );
      return response({ scene_count: 2, word_count: 10, scene_ids: ["scene-0001", "scene-0002"], warnings: [] });
    }
    if (root === "scene" && action === "list") {
      return response(harness.scenes.map(({ body: _body, ...scene }) => scene));
    }
    if (root === "scene" && action === "add") {
      const now = "2026-07-15T12:00:00Z";
      const sceneNumber = harness.scenes.length + 1;
      const sceneId = `scene-${String(sceneNumber).padStart(4, "0")}`;
      const created = {
        id: sceneId,
        title: argument(args, "--title"),
        summary: argument(args, "--summary"),
        pov: argument(args, "--pov"),
        status: argument(args, "--status"),
        body: argument(args, "--body"),
        created_at: now,
        updated_at: now,
        path: `manuscript/scenes/${String(sceneNumber).padStart(4, "0")}-opening.md`,
      };
      harness.scenes.push(created);
      harness.plan.unassigned_scene_ids.push(sceneId);
      return response(created);
    }
    if (root === "scene" && action === "get") {
      return response(harness.scenes.find((scene) => scene.id === argument(args, "--id")));
    }
    if (root === "scene" && action === "update") {
      harness.saveRoots.push(payload.projectRoot || "");
      const scene = harness.scenes.find((item) => item.id === argument(args, "--id"));
      if (!scene) return response("Unknown scene", 1);
      if (harness.saveGate) await harness.saveGate();
      if (hasArgument(args, "--title")) scene.title = argument(args, "--title");
      if (hasArgument(args, "--summary")) scene.summary = argument(args, "--summary");
      if (hasArgument(args, "--pov")) scene.pov = argument(args, "--pov");
      if (hasArgument(args, "--status")) scene.status = argument(args, "--status");
      if (hasArgument(args, "--body")) scene.body = argument(args, "--body");
      return response(scene);
    }
    if (root === "codex" && action === "list") return response(harness.entities);
    if (root === "codex" && action === "add") {
      const now = "2026-07-15T12:00:00Z";
      const entity = { id: `entity-${harness.entities.length + 1}`, type: argument(args, "--type"), name: argument(args, "--name"), description: argument(args, "--description"), category: argument(args, "--type"), aliases: [], tags: [], details: [], notes: "", ai_visibility: "include", scope: "project", created_at: now, updated_at: now };
      harness.entities.push(entity); return response(entity);
    }
    if (root === "codex" && action === "get") return response(harness.entities.find((row) => row.id === argument(args, "--id")));
    if (root === "codex" && action === "relationship-list") return response(harness.relationships);
    if (root === "codex" && action === "relationship-add") {
      const source = harness.entities.find((row) => row.id === argument(args, "--source"));
      const target = harness.entities.find((row) => row.id === argument(args, "--target"));
      const relationship = {
        id: `relationship-${harness.relationships.length + 1}`,
        source_entity_id: source?.id,
        source_name: source?.name,
        target_entity_id: target?.id,
        target_name: target?.name,
        relation: argument(args, "--relation"),
        notes: argument(args, "--notes"),
        valid_from_scene_id: argument(args, "--valid-from"),
        valid_to_scene_id: argument(args, "--valid-to"),
      };
      harness.relationships.push(relationship);
      return response(relationship);
    }
    if (root === "memory" && action === "list") return response(harness.suggestions.filter((row) => !argument(args, "--status") || row.status === argument(args, "--status")));
    if (root === "memory" && action === "scan") return response({
      scanned_scenes: harness.scenes.length,
      added: 0,
      refreshed: harness.suggestions.length,
      pending: harness.suggestions.filter((row) => row.status === "pending").length,
      suggestions: harness.suggestions,
    });
    if (root === "memory" && action === "review") {
      const suggestion = harness.suggestions.find((row) => row.id === argument(args, "--id"));
      if (!suggestion) return response("Unknown suggestion", 1);
      suggestion.status = argument(args, "--disposition");
      if (suggestion.status === "accepted" && suggestion.kind === "relationship_create") {
        const existing = harness.relationships.find((row) => row.source_entity_id === suggestion.source_entity_id && row.target_entity_id === suggestion.target_entity_id && row.relation === suggestion.relation);
        if (!existing) {
          const relationship = {
            id: `relationship-${harness.relationships.length + 1}`,
            source_entity_id: suggestion.source_entity_id,
            source_name: suggestion.source_name,
            target_entity_id: suggestion.target_entity_id,
            target_name: suggestion.target_name,
            relation: suggestion.relation,
            notes: suggestion.description,
            valid_from_scene_id: suggestion.valid_from_scene_id,
            valid_to_scene_id: suggestion.valid_to_scene_id || "",
            created_at: "2026-07-15T12:00:00Z",
          };
          harness.relationships.push(relationship);
          suggestion.created_relationship_id = relationship.id;
        }
      }
      return response(suggestion);
    }
    if (root === "memory" && action === "correct") {
      const suggestion = harness.suggestions.find((row) => row.id === argument(args, "--id"));
      if (!suggestion) return response("Unknown suggestion", 1);
      suggestion.name = argument(args, "--name") || suggestion.name;
      suggestion.description = argument(args, "--description") || suggestion.description;
      suggestion.author_corrected = true;
      return response(suggestion);
    }
    if (root === "memory" && action === "fact-list") return response(harness.facts);
    if (root === "memory" && action === "setup-list") return response([]);
    if (root === "memory" && action === "question-list") return response([]);
    if (root === "memory" && action === "arc-list") return response(harness.arcStates);
    if (root === "memory" && action === "diagnose") return response({ diagnostics: [], summary: { errors: 0, warnings: 0, info: 0 } });
    if (root === "memory" && action === "fact-add") {
      const fact = { id: `fact-${harness.facts.length + 1}`, subject_entity_id: argument(args, "--subject"), predicate: argument(args, "--predicate"), value: argument(args, "--value"), status: "accepted", confidence: 1, evidence: JSON.parse(argument(args, "--evidence-json")), validity: { from_scene_id: argument(args, "--valid-from"), to_scene_id: argument(args, "--valid-to") }, knowledge: [], scope: argument(args, "--scope") };
      harness.facts.push(fact); return response(fact);
    }
    if (root === "check" && action === "startup") {
      return response({
        checked_at: "2026-07-15T12:00:00Z",
        project_root: harness.projectRoot,
        repair_requested: args.includes("--repair"),
        ready: true,
        errors: 0,
        warnings: 0,
        checks: [],
      });
    }
    if (root === "proposal" && action === "list") return response(harness.proposals);
    if (root === "proposal" && action === "generate") {
      const now = "2026-07-15T12:01:00Z";
      const proposalId = harness.proposals.length === 0 ? "proposal-golden" : `proposal-golden-${harness.proposals.length + 1}`;
      const proposal = {
        id: proposalId,
        title: "Strengthen the turning point",
        instruction: argument(args, "--instruction"),
        scene_id: argument(args, "--scene"),
        status: "pending",
        source: "ai_generate",
        proposed_body: "",
        notes: "",
        stale: false,
        created_at: now,
        updated_at: now,
        change_group_id: argument(args, "--change-group"),
        generation: {
          id: "gen-golden",
          provider: "local",
          model: "local-deterministic",
          temperature: 0,
          max_output_tokens: 800,
          context_scene_radius: 1,
          codex_limit: 12,
          input_tokens: 20,
          output_tokens: 40,
          latency_ms: 5,
          provider_attempts: 1,
          estimated_cost_usd: 0,
          quality_tier: "high",
          log_path: ".openauthor/generations/gen-golden.json",
        },
      };
      harness.proposals.push(proposal);
      harness.runs.push({
        run_id: "gen-golden",
        scene_id: proposal.scene_id,
        status: "succeeded",
        provider: "local",
        quality_tier: "high",
        estimated_cost_usd: 0,
        latency_ms: 5,
      });
      return response(proposal);
    }
    if (root === "proposal" && action === "draft") {
      const proposal = harness.proposals.find((item) => item.id === argument(args, "--id"));
      if (!proposal) return response("Unknown proposal", 1);
      proposal.proposed_body = "Mara chooses the dangerous road, knowing the cost.";
      proposal.draft = {
        generation_id: "gen-draft",
        provider: "local",
        model: "local-deterministic",
        temperature: 0,
        max_output_tokens: 800,
        input_tokens: 25,
        output_tokens: 12,
        latency_ms: 4,
        estimated_cost_usd: 0,
        changed: true,
        log_path: ".openauthor/generations/gen-draft.json",
        created_at: "2026-07-15T12:02:00Z",
      };
      proposal.change_set = {
        schema_version: 1,
        id: `change-set-${proposal.id}`,
        proposal_id: proposal.id,
        scene_id: proposal.scene_id,
        created_at: "2026-07-15T12:02:00Z",
        intent: { goal: proposal.instruction, scope: "scene", constraints: [], protected_elements: [] },
        base_body: "Mara waits at the crossroads.",
        proposed_body: proposal.proposed_body,
        hunks: [{
          id: `hunk-001-${proposal.id}`,
          order: 1,
          kind: "replace",
          before_start: 0,
          before_end: 1,
          after_start: 0,
          after_end: 1,
          before_text: "Mara waits at the crossroads.",
          after_text: proposal.proposed_body,
          decision: "accepted",
          rationale: "Rewrites this passage in support of the revision intent.",
        }],
        impact_report: { risk: "low", affected_scenes: [proposal.scene_id], affected_story_memory: [], warnings: [] },
        provenance: { provider: "local", model: "local-deterministic", generation_id: "gen-draft", citations: [] },
      };
      return response(proposal);
    }
    if (root === "proposal" && action === "apply") {
      const proposal = harness.proposals.find((item) => item.id === argument(args, "--id"));
      const scene = harness.scenes.find((item) => item.id === proposal?.scene_id);
      if (!proposal || !scene) return response("Unknown proposal", 1);
      scene.body = proposal.proposed_body;
      proposal.status = "applied";
      proposal.applied_changes = true;
      proposal.pre_apply_snapshot = "snapshot-before-proposal-golden";
      proposal.applied_revision = "snapshot-after-proposal-golden";
      proposal.applied_scene_digest = "applied-digest";
      return response(proposal);
    }
    if (root === "proposal" && action === "hunk") {
      const proposal = harness.proposals.find((item) => item.id === argument(args, "--id"));
      const changeSet = proposal?.change_set as { hunks?: Array<Record<string, unknown>> } | undefined;
      const hunk = changeSet?.hunks?.find((item) => item.id === argument(args, "--hunk"));
      if (!proposal || !hunk) return response("Unknown Change Hunk", 1);
      hunk.decision = argument(args, "--decision");
      return response(proposal);
    }
    if (root === "proposal" && action === "hunk-regenerate") {
      const proposal = harness.proposals.find((item) => item.id === argument(args, "--id"));
      const changeSet = proposal?.change_set as { hunks?: Array<Record<string, unknown>> } | undefined;
      const hunk = changeSet?.hunks?.find((item) => item.id === argument(args, "--hunk"));
      if (!proposal || !hunk) return response("Unknown Change Hunk", 1);
      hunk.regeneration = { author_feedback: argument(args, "--feedback"), provider: argument(args, "--provider") };
      return response(proposal);
    }
    if (root === "proposal" && action === "undo") {
      const proposal = harness.proposals.find((item) => item.id === argument(args, "--id"));
      const scene = harness.scenes.find((item) => item.id === proposal?.scene_id);
      if (!proposal || !scene) return response("Unknown proposal", 1);
      scene.body = "Mara waits at the crossroads.";
      proposal.undone_at = "2026-07-15T12:03:00Z";
      proposal.undo_revision = "snapshot-undo-proposal-golden";
      proposal.restored_revision = proposal.pre_apply_snapshot;
      return response(proposal);
    }
    if (root === "generation" && action === "list") return response(harness.runs);
    if (root === "generation" && action === "budget") {
      const usage = { runs: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost_usd: 0, unknown_cost_runs: 0 };
      return response({
        policy: {
          schema_version: 1,
          enforcement: "fail_closed",
          per_run: { max_input_tokens: null, max_output_tokens: null, max_total_tokens: null, max_estimated_cost_usd: null },
          rolling: { daily_tokens: null, daily_estimated_cost_usd: null, weekly_tokens: null, weekly_estimated_cost_usd: null },
        },
        usage: { as_of: "2026-07-15T12:00:00Z", daily: usage, weekly: usage, lifetime: usage },
      });
    }
    if (root === "generation" && action === "config") {
      const provider = { default_model: "local-deterministic", credential_present: true };
      return response({
        retry: { max_retries: 2, base_delay_ms: 350 },
        providers: {
          local: provider,
          openai: { ...provider, base_url: "" },
          anthropic: { ...provider, base_url: "" },
          openrouter: { ...provider, base_url: "" },
          "openai-codex": {
            ...provider,
            runtime_available: true,
            auth_type: "codex_app_server",
            email: "",
            plan_type: "plus",
            error: "",
          },
        },
      });
    }
    if (root === "revision" && action === "list") return response(harness.versions);
    if (root === "revision" && action === "save") {
      const version = { id: "revision-named", parent: "", message: argument(args, "--message"), kind: "manual", created_at: new Date().toISOString(), file_count: harness.scenes.length };
      harness.versions.push(version);
      return response(version);
    }
    if (root === "revision" && action === "diff") return response({
      base_revision: argument(args, "--base"), head_revision: argument(args, "--head"), changed_file_count: 0,
      files: ["manuscript/structure.json", "codex/codex.json"].map(path => ({ path, status: "unchanged", before: "{}", after: "{}", diff: "" })),
    });
    if (root === "revision" && action === "retrospective") return response({ summary: "Named version", changed_scenes: [], remaining_goals: [], intent: "" });
    if (root === "revision" && action === "restore") return response({ kind: "restore" });
    if (root === "pass" && action === "list") return response([
      { id: "pass-pacing", name: "Pacing", goal: "Improve narrative momentum.", instruction: "Run a pacing pass.", context_policy: { current_scene: true, nearby_scenes: 1, story_memory: "auto" }, evaluation_criteria: ["momentum"], built_in: true }
    ]);
    if (root === "style" && action === "get") return response(null);
    if (root === "storyline" && action === "list") return response({ primary_branch: harness.primaryBranch, current_branch: harness.currentBranch, storylines: harness.storylines });
    if (root === "storyline" && action === "create") {
      harness.branchScenes[harness.currentBranch] = structuredClone(harness.scenes);
      harness.storylines.forEach((row) => { row.current = false; });
      const row = {
        id: "storyline-golden", name: argument(args, "--name"), branch: "storyline/golden", status: "active",
        source_branch: harness.primaryBranch, base_revision: "rev-base", current: true, branch_available: true,
        experiment_brief: { hypothesis: argument(args, "--hypothesis"), protected_constraints: [], intended_scope: argument(args, "--scope"), success_criteria: argument(args, "--success") },
        divergence: { ahead_by: 0, behind_by: 0, changed_files: 0, changed_scenes: 0 }, created_at: "2026-07-15T12:00:00Z", updated_at: "2026-07-15T12:00:00Z", last_activity_at: "2026-07-15T12:00:00Z"
      };
      harness.storylines.push(row); harness.currentBranch = row.branch; return response(row);
    }
    if (root === "storyline" && action === "switch") {
      harness.branchScenes[harness.currentBranch] = structuredClone(harness.scenes);
      const primary = args.includes("--primary");
      harness.currentBranch = primary ? harness.primaryBranch : String(harness.storylines.find((row) => row.id === argument(args, "--id"))?.branch ?? harness.primaryBranch);
      harness.storylines.forEach((row) => { row.current = row.branch === harness.currentBranch; });
      harness.scenes = structuredClone(harness.branchScenes[harness.currentBranch] ?? harness.scenes);
      return response({ branch: harness.currentBranch, current: true, primary });
    }
    if (root === "storyline" && action === "compare") return response({
      storyline: harness.storylines[0], primary_branch: harness.primaryBranch, ahead_by: 1, behind_by: 0,
      categories: { scenes: 1, plan: 0, story_memory: 0, settings: 0 }, word_count_delta: 3,
      scenes: [{ path: String(harness.scenes[0]?.path), scene_id: "scene-0001", title: harness.scenes[0]?.title, status: "M", word_count_before: 4, word_count_after: 7, word_count_delta: 3, prose_changed: true }], files: [],
      semantic_delta: { canon_facts: { added: [], changed: [], removed: [] }, setups: { added: [], changed: [], removed: [] }, open_questions: { added: [], changed: [], removed: [] }, arcs: { added: [], changed: [], removed: [] } },
      impact_analysis: { before: { hypothesis: "", success_criteria: "", protected_constraints: [] }, after: { changed_scene_count: 1, semantic_change_count: 0, word_count_delta: 3, risks: [], summary: "1 scene and 0 story-model records diverge from Primary." } }
    });
    if (root === "storyline" && action === "integrate") return response({ proposal_count: 1, proposals: [] });
    if (root === "storyline" && ["save", "archive", "restore", "rename", "duplicate"].includes(action)) return response({ ok: true });
    if (root === "plan" && action === "get") return response(harness.plan);
    if (root === "plan" && action === "brief") {
      harness.plan.brief = {
        synopsis: argument(args, "--synopsis"),
        genre: argument(args, "--genre"),
        themes: args.flatMap((value, index) => value === "--theme" ? [args[index + 1] ?? ""] : []).filter(Boolean),
        style_guide: argument(args, "--style-guide"),
        outline: argument(args, "--outline"),
      };
      return response(harness.plan);
    }
    if (root === "plan" && action === "act-add") {
      const act = { id: "act-golden", title: argument(args, "--title"), synopsis: argument(args, "--synopsis"), position: harness.plan.acts.length + 1, chapters: [] as Array<Record<string, unknown>> };
      harness.plan.acts.push(act);
      return response(act);
    }
    if (root === "plan" && action === "chapter-add") {
      const act = harness.plan.acts.find((item) => item.id === argument(args, "--act"));
      if (!act) return response("Unknown act", 1);
      const chapters = act.chapters as Array<Record<string, unknown>>;
      const chapter = { id: "chapter-golden", title: argument(args, "--title"), synopsis: "", position: chapters.length + 1, scene_ids: [] as string[] };
      chapters.push(chapter);
      return response(chapter);
    }
    if (root === "plan" && action === "scene-preview") {
      return response({
        scene_id: argument(args, "--scene"),
        from_chapter_id: null,
        to_chapter_id: argument(args, "--chapter") || null,
        before_scene_id: argument(args, "--before") || null,
        summary: "Move The Arrival from Unassigned to False Morning.",
        warnings: [],
      });
    }
    if (root === "plan" && action === "scene-assign") {
      const sceneId = argument(args, "--scene");
      const chapterId = argument(args, "--chapter");
      harness.plan.unassigned_scene_ids = harness.plan.unassigned_scene_ids.filter((id) => id !== sceneId);
      for (const act of harness.plan.acts) {
        for (const chapter of act.chapters as Array<Record<string, unknown>>) {
          chapter.scene_ids = (chapter.scene_ids as string[]).filter((id) => id !== sceneId);
          if (chapter.id === chapterId) (chapter.scene_ids as string[]).push(sceneId);
        }
      }
      if (!chapterId) harness.plan.unassigned_scene_ids.push(sceneId);
      return response(harness.plan);
    }
    if (root === "plan" && action === "beat-add") {
      const beat = { id: "beat-golden", scene_id: argument(args, "--scene"), summary: argument(args, "--summary"), status: "planned", position: 1, created_at: "2026-07-15T12:00:00Z" };
      harness.plan.beats.push(beat);
      return response(beat);
    }
    if (root === "plan" && action === "scene-meta") {
      const sceneId = argument(args, "--scene");
      harness.plan.scene_metadata[sceneId] = {
        timeline_position: argument(args, "--timeline"),
        labels: args.flatMap((value, index) => value === "--label" ? [args[index + 1] ?? ""] : []).filter(Boolean),
      };
      return response(harness.plan.scene_metadata[sceneId]);
    }
    if (root === "branch" && action === "list") return response([]);
    if (root === "search") return response(harness.scenes.map((scene) => ({
      source_kind: "scene",
      source_id: scene.id,
      title: scene.title,
      path: scene.path,
      excerpt: scene.body,
      score: 1,
    })));
    if (root === "chat" && action === "thread") return response([]);
    throw new Error(`Unexpected core command: ${args.join(" ")}`);
  }),
}));

describe("active V2 author workflow", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: { invoke: mockedInvoke },
      configurable: true,
    });
    harness.initialized = false;
    harness.projectId = "proj-golden-loop";
    harness.projectRoot = "/tmp/openauthor-golden-loop";
    harness.scenes.length = 0;
    harness.proposals.length = 0;
    harness.runs.length = 0;
    harness.entities.length = 0;
    harness.relationships.length = 0;
    harness.facts.length = 0;
    harness.arcStates.length = 0;
    harness.suggestions.length = 0;
    harness.plan = {
      schema_version: 1,
      brief: { synopsis: "", genre: "", themes: [], style_guide: "", outline: "" },
      acts: [],
      unassigned_scene_ids: [],
      scene_metadata: {},
      beats: [],
      notes: [],
    };
    harness.storylines.length = 0;
    harness.primaryBranch = "main";
    harness.currentBranch = "main";
    harness.calls.length = 0;
    harness.saveGate = null;
    harness.saveRoots.length = 0;
    harness.versions.length = 0;
    harness.branchScenes = {};
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  async function openWritingScene() {
    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Save Safety");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "Opening");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));
    return { user, body: await screen.findByPlaceholderText("Begin writing...") as HTMLTextAreaElement };
  }

  it("keeps newer typing and saves it after an older save response", async () => {
    const { body } = await openWritingScene();
    let finish!: () => void;
    harness.saveGate = () => new Promise<void>(resolve => { finish = resolve; });
    fireEvent.change(body, { target: { value: "First edit" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.change(body, { target: { value: "First edit plus newer typing" } });
    harness.saveGate = null;
    await act(async () => { finish(); });
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("First edit plus newer typing"));
    expect(body.value).toBe("First edit plus newer typing");
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("resumes newer writing when reopening a tab during its pending save", async () => {
    const { user, body } = await openWritingScene();
    let finish!: () => void;
    harness.saveGate = () => new Promise<void>(resolve => { finish = resolve; });
    fireEvent.change(body, { target: { value: "First edit" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.change(body, { target: { value: "Newer writing before navigation" } });
    await user.click(screen.getByTitle(/Plan \(/));
    await user.click(screen.getByRole("tab", { name: /Opening/ }));
    const reopened = await screen.findByPlaceholderText("Begin writing...") as HTMLTextAreaElement;
    expect(reopened.value).toBe("Newer writing before navigation");
    fireEvent.change(reopened, { target: { value: "Writing after returning" } });
    harness.saveGate = null;
    await act(async () => { finish(); });
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("Writing after returning"));
    expect(reopened.value).toBe("Writing after returning");
  });

  it("retains the recovery draft after a failed save and retries the latest writing", async () => {
    const { user, body } = await openWritingScene();
    harness.saveGate = async () => { throw new Error("Disk unavailable"); };
    fireEvent.change(body, { target: { value: "Writing worth keeping" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(await screen.findByRole("button", { name: "Retry save" })).toBeTruthy();
    expect(body.value).toBe("Writing worth keeping");
    expect(Object.values(localStorage).some(value => String(value).includes("Writing worth keeping"))).toBe(true);
    harness.saveGate = null;
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("Writing worth keeping"));
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("finishes pending saves in their original project after creating another project", async () => {
    const { user, body } = await openWritingScene();
    const originalRoot = harness.projectRoot;
    let finish!: () => void;
    harness.saveGate = () => new Promise<void>(resolve => { finish = resolve; });
    fireEvent.change(body, { target: { value: "First novel writing" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.change(body, { target: { value: "First novel final writing" } });
    await user.click(screen.getByRole("button", { name: "Projects" }));
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Second Novel");
    const folder = screen.getByRole("textbox", { name: "Project folder" });
    await user.clear(folder);
    await user.type(folder, "/tmp/openauthor-save-second");
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await waitFor(() => expect(harness.projectRoot).toBe("/tmp/openauthor-save-second"));
    harness.saveGate = null;
    await act(async () => { finish(); });
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("First novel final writing"));
    expect(harness.saveRoots).toEqual([originalRoot, originalRoot]);
    expect(screen.queryByRole("tab", { name: /Opening/ })).toBeNull();
  });

  it("saves a named version after flushing unsaved manuscript writing", async () => {
    const { user, body } = await openWritingScene();
    fireEvent.change(body, { target: { value: "The version must include this sentence." } });
    await user.click(screen.getByTitle(/Changes \(/));
    await user.type(screen.getByRole("textbox", { name: "Version name" }), "Before the alternate ending");
    await user.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() => expect(harness.versions).toHaveLength(1));
    expect(harness.scenes[0]?.body).toBe("The version must include this sentence.");
    expect(await screen.findByRole("button", { name: /Before the alternate ending/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Before the alternate ending/ }));
    await user.click(await screen.findByRole("button", { name: "Restore plan" }));
    await waitFor(() => expect(harness.calls.some(args => args[0] === "revision" && args[1] === "restore" && argument(args, "--path") === "manuscript/structure.json")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Restore Story Memory" }));
    await waitFor(() => expect(harness.calls.some(args => args[0] === "revision" && args[1] === "restore" && argument(args, "--path") === "codex/codex.json")).toBe(true));
  });

  it("backs up current writing through Settings and restores into a separate folder", async () => {
    const { user, body } = await openWritingScene();
    fireEvent.change(body, { target: { value: "Include my most recent writing." } });
    await user.click(screen.getByRole("button", { name: "Settings (Cmd+,)" }));
    await user.type(await screen.findByRole("textbox", { name: "Backup file" }), "/tmp/novel.openauthor.zip");
    await user.click(screen.getByRole("button", { name: "Create verified backup" }));
    await waitFor(() => expect(harness.calls.some(args => args[0] === "backup" && args[1] === "create")).toBe(true));
    const saveIndex = harness.calls.findIndex(args => args[0] === "scene" && args[1] === "update");
    const backupIndex = harness.calls.findIndex(args => args[0] === "backup");
    expect(saveIndex).toBeLessThan(backupIndex);
    expect(harness.scenes[0]?.body).toBe("Include my most recent writing.");
    await user.click(screen.getByRole("button", { name: "Projects" }));
    await user.click(await screen.findByRole("button", { name: "Restore backup" }));
    await user.type(screen.getByRole("textbox", { name: "Backup to restore" }), "/tmp/novel.openauthor.zip");
    await user.type(screen.getByRole("textbox", { name: "Recovery folder" }), "/tmp/novel-restored");
    await user.click(screen.getByRole("button", { name: "Verify and restore" }));
    await waitFor(() => expect(harness.calls.some(args => args[0] === "backup" && args[1] === "restore" && argument(args, "--target") === "/tmp/novel-restored")).toBe(true));
  });

  it("does not report a complete backup when pending writing cannot be saved", async () => {
    const { user, body } = await openWritingScene();
    harness.saveGate = async () => { throw new Error("Disk full"); };
    fireEvent.change(body, { target: { value: "Unsaved writing must not be omitted silently." } });
    await user.click(screen.getByRole("button", { name: "Settings (Cmd+,)" }));
    await user.type(await screen.findByRole("textbox", { name: "Backup file" }), "/tmp/novel.zip");
    await user.click(screen.getByRole("button", { name: "Create verified backup" }));
    expect(await screen.findByText(/Backup failed: Save your pending writing/)).toBeTruthy();
    expect(harness.calls.some(args => args[0] === "backup")).toBe(false);
    harness.saveGate = null;
    await user.click(screen.getByRole("button", { name: "Create verified backup" }));
    await waitFor(() => expect(harness.calls.some(args => args[0] === "backup")).toBe(true));
  });

  it("creates a project, edits a scene, and applies a reviewed proposal", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    expect(await screen.findByText("Choose a project to begin writing.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Golden Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));

    expect(await screen.findByText("No scenes yet.")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("New scene title..."), "The First Choice");
    await user.type(screen.getByPlaceholderText("POV"), "Mara");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    const body = await screen.findByPlaceholderText("Begin writing...");
    await user.type(body, "Mara waits at the crossroads.");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("Mara waits at the crossroads."));

    await user.click(screen.getByTitle(/Changes \(/));
    await user.click(screen.getByTitle("Create a reviewable Change Set"));
    await user.type(
      await screen.findByPlaceholderText(/Tighten the pacing/),
      "Make Mara commit to the dangerous route."
    );
    await user.click(screen.getAllByRole("button", { name: "Create Change Set" })[0]);

    expect(await screen.findByText("Mara chooses the dangerous road, knowing the cost.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await user.type(screen.getByLabelText("Revision comment for hunk 1"), "Make the consequence immediate.");
    await user.click(screen.getByRole("button", { name: "Revise hunk" }));
    await waitFor(() => expect(harness.calls.some((args) => args[0] === "proposal" && args[1] === "hunk-regenerate" && argument(args, "--feedback") === "Make the consequence immediate.")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Exclude change hunk 1" }));
    expect(await screen.findByRole("button", { name: "Include change hunk 1" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Include change hunk 1" }));
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));

    await waitFor(() => expect(harness.proposals[0]?.status).toBe("applied"));
    expect(harness.scenes[0]?.body).toBe("Mara chooses the dangerous road, knowing the cost.");
    expect(harness.proposals[0]?.pre_apply_snapshot).toBe("snapshot-before-proposal-golden");
    expect(harness.calls.some((args) => args[0] === "proposal" && args[1] === "apply")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Undo change" }));
    await waitFor(() => expect(harness.proposals[0]?.undo_revision).toBe("snapshot-undo-proposal-golden"));
    expect(harness.scenes[0]?.body).toBe("Mara waits at the crossroads.");
    expect(await screen.findByDisplayValue("Mara waits at the crossroads.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Strengthen the turning point \u2014 undone/ })).toBeTruthy();
  });

  it("starts a blank novel in a focused workspace with the assistant opt-in", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Blank Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));

    expect(await screen.findByText("Start Blank Novel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
    expect(window.location.pathname).toMatch(/^\/w\/personal-workspace\/p\//);

    await user.click(screen.getByRole("button", { name: "Name your first scene" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText("New scene title...")));
    await user.type(screen.getByPlaceholderText("New scene title..."), "A True Blank Page");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    const body = await screen.findByPlaceholderText("Begin writing...");
    expect((body as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("0 words")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Assistant (Cmd+L)" }));
    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assistant (Cmd+L)" }));
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
  });

  it("keeps rail navigation, the editor, and editable scene details in sync", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Navigation Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Crossing");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));
    const body = await screen.findByPlaceholderText("Begin writing...");
    await user.type(body, "Mara crosses before the signal changes.");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(harness.scenes[0]?.body).toBe("Mara crosses before the signal changes."));

    await user.click(screen.getByRole("button", { name: "Plan (Cmd+Shift+P)" }));
    expect(await screen.findByText("Project Brief")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Plan" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Manuscript (Cmd+Shift+E)" }));
    expect(await screen.findByDisplayValue("Mara crosses before the signal changes.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Assistant (Cmd+L)" }));
    await user.click(await screen.findByRole("button", { name: "Inspector" }));
    await user.selectOptions(screen.getByLabelText("Status"), "revised");
    await user.clear(screen.getByLabelText("Point of view"));
    await user.type(screen.getByLabelText("Point of view"), "Mara");
    await user.type(screen.getByLabelText("Scene summary"), "Mara crosses before the window closes.");
    await user.click(screen.getByRole("button", { name: "Save scene details" }));

    await waitFor(() => expect(harness.scenes[0]?.status).toBe("revised"));
    expect(harness.scenes[0]?.pov).toBe("Mara");
    expect(harness.scenes[0]?.summary).toBe("Mara crosses before the window closes.");
    expect(harness.scenes[0]?.body).toBe("Mara crosses before the signal changes.");
    const metadataCall = harness.calls.find((args) => args[0] === "scene" && args[1] === "update" && argument(args, "--status") === "revised");
    expect(metadataCall).toBeTruthy();
    expect(metadataCall?.includes("--body")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Close side panel" }));
    expect(screen.queryByRole("button", { name: "Inspector" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Search (Cmd+Shift+F)" }));
    await user.type(screen.getByPlaceholderText("Search manuscript..."), "crosses");
    await user.click(await screen.findByRole("button", { name: "Open The Crossing" }));
    expect(await screen.findByDisplayValue("Mara crosses before the signal changes.")).toBeTruthy();
  });

  it("resets editor tabs and panels when a different novel is created", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "First Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), "/tmp/openauthor-first");
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await user.click(await screen.findByRole("button", { name: "Plan (Cmd+Shift+P)" }));
    expect(await screen.findByRole("tab", { name: "Plan" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assistant (Cmd+L)" }));
    expect(await screen.findByRole("button", { name: "Chat" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Projects" }));
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Second Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), "/tmp/openauthor-second");
    await user.click(screen.getByRole("button", { name: "Create novel" }));

    expect(await screen.findByText("Start Second Novel")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Plan" })).toBeNull();
    expect(screen.queryByText("Project Brief")).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
  });

  it("previews manuscript structure before importing a new project", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    expect(await screen.findByText("Choose a project to begin writing.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Imported Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByText("Add existing content"));
    await user.click(screen.getByRole("button", { name: "Manuscript File" }));
    await user.type(screen.getByPlaceholderText(/\/path\/to\/novel\.docx/), "/tmp/novel.docx");
    await user.click(screen.getByRole("button", { name: "Preview Structure" }));

    expect(await screen.findByText("2 scenes · 10 words")).toBeTruthy();
    expect(screen.getByText(/Imported Arrival/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create novel" }));

    expect(await screen.findByText("Imported Arrival")).toBeTruthy();
    expect(screen.getByText("Imported Choice")).toBeTruthy();
    expect(harness.calls.some((args) => args[0] === "manuscript" && args[1] === "preview")).toBe(true);
    expect(harness.calls.some((args) => args[0] === "manuscript" && args[1] === "import")).toBe(true);
  });

  it("creates coordinated AI Change Sets for a multi-scene experiment", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Alternate Ending");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Approach");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Choice");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    await user.click(screen.getByTitle(/Changes \(/));
    await user.click(screen.getByTitle("Create a reviewable Change Set"));
    await user.click(screen.getByLabelText("Coordinate this revision across multiple scenes"));
    await user.click(screen.getByRole("checkbox", { name: "The Choice" }));
    await user.type(screen.getByPlaceholderText(/Tighten the pacing/), "Make the alternate ending escalate across both scenes.");
    await user.click(screen.getByRole("button", { name: "Create 2 Coordinated Change Sets" }));

    await waitFor(() => expect(harness.proposals).toHaveLength(2));
    expect(harness.proposals[0]?.change_group_id).toBeTruthy();
    expect(harness.proposals[1]?.change_group_id).toBe(harness.proposals[0]?.change_group_id);
  });

  it("builds a project brief, hierarchy, and scene beat in the Plan workspace", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);

    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Golden Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Arrival");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    await user.click(screen.getByTitle(/Plan \(/));
    expect(await screen.findByText("Project Brief")).toBeTruthy();
    await user.type(screen.getByLabelText("Genre"), "Speculative mystery");
    await user.type(screen.getByLabelText("Synopsis"), "A missing memory changes a city.");
    await user.click(screen.getByRole("button", { name: "Save Brief" }));
    await waitFor(() => expect(harness.plan.brief.genre).toBe("Speculative mystery"));

    await user.type(screen.getByPlaceholderText("New act title"), "The Disappearance");
    await user.click(screen.getByRole("button", { name: "Add Act" }));
    expect(await screen.findByText("The Disappearance")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("Chapter title"), "False Morning");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findAllByText(/False Morning/)).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Move The Arrival to"), "chapter-golden");
    expect(await screen.findByText("Move The Arrival from Unassigned to False Morning.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(harness.plan.unassigned_scene_ids).not.toContain("scene-0001"));
    expect(harness.calls.some((args) => args[0] === "plan" && args[1] === "scene-assign")).toBe(true);

    await user.type(screen.getByLabelText("New beat for The Arrival"), "The clock skips thirteen minutes.");
    await user.click(screen.getByRole("button", { name: "Add beat to The Arrival" }));
    expect(await screen.findByText(/clock skips thirteen minutes/)).toBeTruthy();
    expect(harness.calls.some((args) => args[0] === "plan" && args[1] === "beat-add")).toBe(true);
    await user.click(screen.getByText("Story time & labels"));
    await user.type(screen.getByLabelText("Story time for The Arrival"), "Day 2, dusk");
    await user.type(screen.getByLabelText("Labels for The Arrival"), "turning point, Mara");
    await user.click(screen.getByRole("button", { name: "Save planning details" }));
    await waitFor(() => expect(harness.plan.scene_metadata["scene-0001"]?.timeline_position).toBe("Day 2, dusk"));
    expect(await screen.findByText("Story time · Day 2, dusk")).toBeTruthy();
  });

  it("creates, compares, and selectively integrates a Storyline without branch vocabulary", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Golden Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Ending");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    await user.click(screen.getByTitle(/Storylines \(/));
    expect(await screen.findByText("New Experiment")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("Storyline name"), "Mara stays behind");
    await user.type(screen.getByPlaceholderText(/Hypothesis/), "The ending is stronger if Mara chooses the city.");
    await user.click(screen.getByRole("button", { name: "Start Storyline" }));
    expect(await screen.findByText("Mara stays behind")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect((await screen.findAllByText("The Ending")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Return to Primary" }));
    await user.click(await screen.findByRole("button", { name: "Prepare 1 Change Set" }));
    await waitFor(() => expect(harness.calls.some((args) => args[0] === "storyline" && args[1] === "integrate")).toBe(true));
  });

  it("flushes Storyline writing and refreshes open scene tabs on returning to Primary", async () => {
    const { user, body } = await openWritingScene();
    fireEvent.change(body, { target: { value: "Primary prose stays protected." } });
    await user.click(screen.getByTitle(/Storylines \(/));
    await user.type(screen.getByPlaceholderText("Storyline name"), "Alternate");
    await user.type(screen.getByPlaceholderText(/Hypothesis/), "Try a different ending.");
    await user.click(screen.getByRole("button", { name: "Start Storyline" }));
    await screen.findByText("Alternate");
    await user.click(screen.getByRole("tab", { name: /Opening/ }));
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    harness.saveGate = () => pending;
    fireEvent.change(screen.getByPlaceholderText("Begin writing..."), { target: { value: "The alternate ending." } });
    await user.click(screen.getByRole("tab", { name: "Storylines" }));
    await user.click(screen.getByRole("button", { name: "Return to Primary" }));
    expect(harness.calls.some(args => args[0] === "storyline" && args[1] === "switch")).toBe(false);
    harness.saveGate = null;
    await act(async () => { finish(); });
    await waitFor(() => expect(harness.currentBranch).toBe("main"));
    await user.click(screen.getByRole("tab", { name: /Opening/ }));
    await waitFor(() => expect((screen.getByPlaceholderText("Begin writing...") as HTMLTextAreaElement).value).toBe("Primary prose stays protected."));
    await user.click(screen.getByRole("tab", { name: "Storylines" }));
    await user.click(await screen.findByRole("button", { name: "Enter" }));
    await waitFor(() => expect(harness.currentBranch).toBe("storyline/golden"));
    await user.click(screen.getByRole("tab", { name: /Opening/ }));
    await waitFor(() => expect((screen.getByPlaceholderText("Begin writing...") as HTMLTextAreaElement).value).toBe("The alternate ending."));
  });

  it("records an evidence-backed Canon Fact through Story Memory", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Canon Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    await user.type(screen.getByPlaceholderText("New scene title..."), "The Gate");
    await user.click(screen.getByRole("button", { name: "Add Scene" }));

    await user.click(screen.getByTitle(/Story Memory \(/));
    await user.type(screen.getByPlaceholderText("Entity name..."), "Mara");
    await user.click(screen.getByRole("button", { name: "Add Memory Entry" }));
    expect(await screen.findByText("Mara")).toBeTruthy();
    await user.type(screen.getByPlaceholderText("Entity name..."), "Soren");
    await user.click(screen.getByRole("button", { name: "Add Memory Entry" }));
    await user.click(await screen.findByRole("button", { name: /Mara/ }));
    expect(await screen.findByText("No connections yet. Link Mara to another character, place, faction, or object below.")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Related entry"), "entity-2");
    await user.type(screen.getByLabelText("Connection"), "distrusts");
    await user.type(screen.getByLabelText("Context"), "Soren concealed the missing memory.");
    await user.click(screen.getByRole("button", { name: "Add connection" }));
    expect(await screen.findByText("→ distrusts →")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Canon & Continuity" }));
    expect(await screen.findByText("Add Canon Fact")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Fact subject"), "entity-1");
    await user.type(screen.getByLabelText("Fact predicate"), "carries");
    await user.type(screen.getByLabelText("Fact value"), "the brass key");
    await user.type(screen.getByLabelText("Evidence excerpt"), "Mara carries the brass key.");
    await user.click(screen.getByRole("button", { name: "Add Fact" }));
    await waitFor(() => expect(harness.facts).toHaveLength(1));
    expect(await screen.findByText("the brass key")).toBeTruthy();
  });

  it("corrects and bulk-decides review-first Story Memory suggestions", async () => {
    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Memory Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");
    harness.suggestions.push(
      { id: "suggestion-1", kind: "entity_create", entity_type: "item", name: "Silver Bell", description: "A bell in the archive.", confidence: 0.9, reason: "Repeated noun", status: "pending", evidence: [{ scene_id: "scene-0001", path: "", excerpt: "The bell rang.", start: 0, end: 13 }] },
      { id: "suggestion-2", kind: "entity_create", entity_type: "character", name: "Mara", description: "Archive keeper.", confidence: 0.88, reason: "Repeated name", status: "pending", evidence: [{ scene_id: "scene-0001", path: "", excerpt: "Mara listened.", start: 0, end: 14 }] },
    );

    await user.click(screen.getByTitle(/Story Memory \(/));
    expect(await screen.findByText("Silver Bell")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Correct" })[0]);
    const name = screen.getByLabelText("Corrected name for Silver Bell");
    await user.clear(name);
    await user.type(name, "Brass Bell");
    await user.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByText("Brass Bell")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Accept all" }));
    await waitFor(() => expect(harness.suggestions.every((row) => row.status === "accepted")).toBe(true));
    expect(harness.calls.some((args) => args[0] === "memory" && args[1] === "correct")).toBe(true);
  });

  it("keeps prose-found relationships review-first before adding them to the Connection Map", async () => {
    harness.entities.push(
      { id: "entity-mara", type: "character", name: "Mara", description: "Archive keeper.", aliases: [], tags: [], details: [], notes: "", ai_visibility: "include", scope: "project", created_at: "2026-07-15T12:00:00Z", updated_at: "2026-07-15T12:00:00Z" },
      { id: "entity-soren", type: "character", name: "Soren", description: "Memory broker.", aliases: [], tags: [], details: [], notes: "", ai_visibility: "include", scope: "project", created_at: "2026-07-15T12:00:00Z", updated_at: "2026-07-15T12:00:00Z" },
    );
    harness.suggestions.push({
      id: "relationship-suggestion-1",
      kind: "relationship_create",
      name: "Mara distrusts Soren",
      description: "Explicit relationship statement found in manuscript prose.",
      confidence: 0.82,
      reason: "Explicit named relationship in manuscript prose",
      status: "pending",
      source_entity_id: "entity-mara",
      source_name: "Mara",
      target_entity_id: "entity-soren",
      target_name: "Soren",
      relation: "distrusts",
      valid_from_scene_id: "scene-0001",
      valid_to_scene_id: "",
      evidence: [{ scene_id: "scene-0001", path: "manuscript/scenes/0001-the-gate.md", excerpt: "Mara distrusts Soren", start: 0, end: 21 }],
    });

    const user = userEvent.setup();
    render(<AppV2 />);
    await screen.findByText("Choose a project to begin writing.");
    await user.click(screen.getByRole("button", { name: "New Project" }));
    await user.type(screen.getByRole("textbox", { name: "Novel title" }), "Connection Novel");
    await user.type(screen.getByRole("textbox", { name: "Project folder" }), harness.projectRoot);
    await user.click(screen.getByRole("button", { name: "Create novel" }));
    await screen.findByText("No scenes yet.");

    await user.click(screen.getByTitle(/Story Memory \(/));
    await user.click(screen.getByRole("button", { name: "Connection Map" }));
    expect(await screen.findByRole("heading", { name: "Connection Map" })).toBeTruthy();
    expect(await screen.findByText("“Mara distrusts Soren”")).toBeTruthy();
    expect(harness.relationships).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(harness.relationships).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("Connection map summary").textContent).toContain("1 accepted connections"));
    expect(await screen.findByText("→ distrusts →")).toBeTruthy();
  });
});
